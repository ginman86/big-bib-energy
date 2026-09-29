// Package app is the Big Bib Energy API: one http.Handler, served by Lambda or locally.
package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/ginman86/big-bib-energy/api/internal/store"
	"github.com/ginman86/big-bib-energy/api/internal/strava"
)

const (
	sessionCookie = "bbe_session"
	sessionTTL    = 90 * 24 * time.Hour
	// csrfHeader must be present on state-changing requests. Cross-site forms can't set custom
	// headers, and a cross-origin fetch that sets one needs a CORS preflight we never grant.
	csrfHeader    = "X-BBE"
	maxBodyBytes  = 64 << 10
	maxSettingsSz = 16 << 10
)

// Config comes from the environment (Lambda) or flags (local).
type Config struct {
	Version string
	// Origins allowed on state-changing requests, e.g. https://bigbib.ginman.dev.
	Origins []string
	// InsecureCookies drops the Secure flag (only for plain-http dev servers other than localhost).
	InsecureCookies bool
}

type App struct {
	cfg    Config
	store  store.Store
	blobs  store.Blobs
	strava *strava.Client
	now    func() time.Time
	poll   time.Duration // Strava upload status poll interval
}

func New(cfg Config, s store.Store, b store.Blobs, sc *strava.Client) *App {
	return &App{cfg: cfg, store: s, blobs: b, strava: sc, now: time.Now, poll: pollInterval}
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("POST /api/auth/strava", a.csrf(a.signIn))
	mux.HandleFunc("POST /api/auth/logout", a.csrf(a.logout))
	mux.HandleFunc("GET /api/me", a.authed(a.me))
	mux.HandleFunc("PUT /api/me/settings", a.csrf(a.authed(a.putSettings)))
	mux.HandleFunc("DELETE /api/me", a.csrf(a.authed(a.deleteMe)))
	mux.HandleFunc("POST /api/rides", a.csrf(a.authed(a.postRide)))
	mux.HandleFunc("GET /api/rides", a.authed(a.listRides))
	mux.HandleFunc("POST /api/rides/import", a.csrf(a.authed(a.importRides)))
	for _, k := range []customKind{workoutsKind, coursesKind} {
		mux.HandleFunc("GET /api/"+k.list, a.authed(a.listCustom(k)))
		mux.HandleFunc("PUT /api/"+k.list+"/{id}", a.csrf(a.authed(a.putCustom(k))))
		mux.HandleFunc("DELETE /api/"+k.list+"/{id}", a.csrf(a.authed(a.deleteCustom(k))))
	}
	return mux
}

func (a *App) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": a.cfg.Version})
}

// ——— Auth ———

type signInRequest struct {
	Code  string `json:"code"`
	Scope string `json:"scope"` // as granted, from the OAuth redirect
}

func (a *App) signIn(w http.ResponseWriter, r *http.Request) {
	var req signInRequest
	if err := readJSON(r, &req); err != nil || req.Code == "" {
		writeError(w, http.StatusBadRequest, "missing code")
		return
	}
	ctx := r.Context()
	tok, err := a.strava.Exchange(ctx, req.Code)
	if err != nil || tok.Athlete == nil {
		slog.WarnContext(ctx, "strava exchange failed", "err", err)
		writeError(w, http.StatusBadGateway, "Strava sign-in failed")
		return
	}
	scopes := strava.ParseScopes(req.Scope)
	profile := *tok.Athlete
	// FTP and weight are only on the detailed profile, which needs profile:read_all.
	if scopes["profile:read_all"] {
		if full, err := a.strava.Athlete(ctx, tok.AccessToken); err == nil {
			profile = full
		} else {
			slog.WarnContext(ctx, "strava athlete fetch failed", "err", err)
		}
	}

	now := a.now()
	ath, err := a.store.GetAthlete(ctx, profile.ID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if ath == nil {
		ath = &store.Athlete{ID: profile.ID, CreatedAt: now}
	}
	ath.Firstname, ath.Lastname = profile.Firstname, profile.Lastname
	if profile.FTP != nil {
		ath.FTP = *profile.FTP
	}
	if profile.Weight != nil {
		ath.WeightKg = *profile.Weight
	}
	ath.Scopes = req.Scope
	ath.Access, ath.Refresh, ath.ExpiresAt = tok.AccessToken, tok.RefreshToken, tok.ExpiresAt
	ath.UpdatedAt = now
	if err := a.store.PutAthlete(ctx, ath); err != nil {
		a.fail(w, r, err)
		return
	}

	value, hash, err := newSessionToken()
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if err := a.store.PutSession(ctx, hash, ath.ID, now.Add(sessionTTL)); err != nil {
		a.fail(w, r, err)
		return
	}
	http.SetCookie(w, a.cookie(value, int(sessionTTL.Seconds())))
	writeJSON(w, http.StatusOK, meResponse(ath))
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = a.store.DeleteSession(r.Context(), hashToken(c.Value))
	}
	http.SetCookie(w, a.cookie("", -1))
	w.WriteHeader(http.StatusNoContent)
}

// ——— Me ———

type athleteCtx struct {
	athlete *store.Athlete
	session string // hash
}

type authedHandler func(w http.ResponseWriter, r *http.Request, s athleteCtx)

// authed resolves the session cookie to an athlete, or responds 401.
func (a *App) authed(h authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "not signed in")
			return
		}
		hash := hashToken(c.Value)
		id, ok, err := a.store.GetSession(r.Context(), hash, a.now())
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if !ok {
			http.SetCookie(w, a.cookie("", -1))
			writeError(w, http.StatusUnauthorized, "session expired")
			return
		}
		ath, err := a.store.GetAthlete(r.Context(), id)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if ath == nil {
			writeError(w, http.StatusUnauthorized, "account not found")
			return
		}
		h(w, r, athleteCtx{ath, hash})
	}
}

type me struct {
	Athlete struct {
		ID        int64   `json:"id"`
		Firstname string  `json:"firstname"`
		Lastname  string  `json:"lastname"`
		FTP       int     `json:"ftp,omitempty"`
		WeightKg  float64 `json:"weightKg,omitempty"`
	} `json:"athlete"`
	CanUpload bool            `json:"canUpload"`
	Settings  json.RawMessage `json:"settings,omitempty"`
}

func meResponse(ath *store.Athlete) me {
	var m me
	m.Athlete.ID, m.Athlete.Firstname, m.Athlete.Lastname = ath.ID, ath.Firstname, ath.Lastname
	m.Athlete.FTP, m.Athlete.WeightKg = ath.FTP, ath.WeightKg
	m.CanUpload = strava.ParseScopes(ath.Scopes)["activity:write"]
	m.Settings = json.RawMessage(ath.Settings)
	return m
}

func (a *App) me(w http.ResponseWriter, _ *http.Request, s athleteCtx) {
	writeJSON(w, http.StatusOK, meResponse(s.athlete))
}

func (a *App) putSettings(w http.ResponseWriter, r *http.Request, s athleteCtx) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxSettingsSz+1))
	if err != nil || len(body) > maxSettingsSz || !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "settings must be JSON under 16 KB")
		return
	}
	s.athlete.Settings = store.JSONText(body)
	s.athlete.UpdatedAt = a.now()
	if err := a.store.PutAthlete(r.Context(), s.athlete); err != nil {
		a.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// deleteMe revokes Strava access and deletes everything we hold for the athlete.
func (a *App) deleteMe(w http.ResponseWriter, r *http.Request, s athleteCtx) {
	ctx := r.Context()
	if access, err := a.freshAccessCtx(ctx, s.athlete); err == nil {
		if err := a.strava.Deauthorize(ctx, access); err != nil {
			slog.WarnContext(ctx, "strava deauthorize failed", "err", err)
		}
	}
	if err := a.store.DeleteAthlete(ctx, s.athlete.ID); err != nil {
		a.fail(w, r, err)
		return
	}
	_ = a.store.DeleteSession(ctx, s.session)
	http.SetCookie(w, a.cookie("", -1))
	w.WriteHeader(http.StatusNoContent)
}

// freshAccessCtx returns a valid Strava access token, refreshing (and persisting) it if needed.
func (a *App) freshAccessCtx(ctx context.Context, ath *store.Athlete) (string, error) {
	if !strava.Expired(ath.ExpiresAt, a.now()) {
		return ath.Access, nil
	}
	tok, err := a.strava.Refresh(ctx, ath.Refresh)
	if err != nil {
		return "", err
	}
	ath.Access, ath.Refresh, ath.ExpiresAt = tok.AccessToken, tok.RefreshToken, tok.ExpiresAt
	return ath.Access, a.store.PutAthlete(ctx, ath)
}

// ——— Plumbing ———

// csrf guards state-changing requests: our custom header, and a same-site Origin when sent.
func (a *App) csrf(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(csrfHeader) != "1" {
			writeError(w, http.StatusForbidden, "missing "+csrfHeader+" header")
			return
		}
		if o := r.Header.Get("Origin"); o != "" && !slices.Contains(a.cfg.Origins, o) {
			writeError(w, http.StatusForbidden, "origin not allowed")
			return
		}
		h(w, r)
	}
}

func (a *App) cookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/api",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   !a.cfg.InsecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
}

// newSessionToken returns a random cookie value and the hash we store for it.
func newSessionToken() (value, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	value = base64.RawURLEncoding.EncodeToString(b)
	return value, hashToken(value), nil
}

func hashToken(v string) string {
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:])
}

func readJSON(r *http.Request, v any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return errors.New("expected application/json")
	}
	return json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes)).Decode(v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (a *App) fail(w http.ResponseWriter, r *http.Request, err error) {
	slog.ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "something went wrong")
}
