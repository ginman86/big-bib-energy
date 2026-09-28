package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ginman86/big-bib-energy/api/internal/store"
	"github.com/ginman86/big-bib-energy/api/internal/strava"
)

const origin = "https://bigbib.ginman.dev"

// fakeStrava serves the token, athlete and deauthorize endpoints.
func fakeStrava(t *testing.T, deauths *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/token":
			_ = r.ParseForm()
			if r.Form.Get("code") == "bad" {
				http.Error(w, `{"message":"Bad Request"}`, 400)
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"at","refresh_token":"rt","expires_at":4000000000,
				"athlete":{"id":42,"firstname":"Greg","lastname":"Inman"}}`))
		case "/api/v3/athlete":
			if r.Header.Get("Authorization") != "Bearer at" {
				t.Errorf("athlete auth %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"id":42,"firstname":"Greg","lastname":"Inman","ftp":265,"weight":72.5}`))
		case "/oauth/deauthorize":
			deauths.Add(1)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	}))
}

type harness struct {
	t       *testing.T
	h       http.Handler
	store   *store.Memory
	deauths *atomic.Int32
	cookie  *http.Cookie
}

func newHarness(t *testing.T) *harness {
	var d atomic.Int32
	srv := fakeStrava(t, &d)
	t.Cleanup(srv.Close)
	sc := strava.New("282789", func(context.Context) (string, error) { return "shh", nil })
	sc.BaseURL = srv.URL
	mem := store.NewMemory()
	return &harness{t: t, h: New(Config{Origins: []string{origin}}, mem, sc).Handler(), store: mem, deauths: &d}
}

func (h *harness) do(method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	if h.cookie != nil {
		req.AddCookie(h.cookie)
	}
	rec := httptest.NewRecorder()
	h.h.ServeHTTP(rec, req)
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			h.cookie = c
			if c.MaxAge < 0 {
				h.cookie = nil
			}
		}
	}
	return rec
}

var ok = map[string]string{"X-BBE": "1", "Origin": origin}

func TestSignInFlow(t *testing.T) {
	h := newHarness(t)
	rec := h.do("POST", "/api/auth/strava", `{"code":"abc","scope":"read,activity:write,profile:read_all"}`, ok)
	if rec.Code != 200 {
		t.Fatalf("sign in %d %s", rec.Code, rec.Body)
	}
	c := h.cookie
	if c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.Path != "/api" {
		t.Fatalf("session cookie %+v", c)
	}
	var m me
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	if m.Athlete.ID != 42 || m.Athlete.FTP != 265 || m.Athlete.WeightKg != 72.5 || !m.CanUpload {
		t.Errorf("me %+v", m)
	}
	// Strava tokens stay server-side.
	if strings.Contains(rec.Body.String(), `"at"`) || strings.Contains(rec.Body.String(), "rt") {
		t.Error("tokens leaked to the browser")
	}
	ath, _ := h.store.GetAthlete(context.Background(), 42)
	if ath.Access != "at" || ath.Refresh != "rt" {
		t.Errorf("stored tokens %+v", ath)
	}

	if rec := h.do("GET", "/api/me", "", nil); rec.Code != 200 {
		t.Errorf("me %d", rec.Code)
	}
	if rec := h.do("PUT", "/api/me/settings", `{"ftp":270,"lthr":168}`, ok); rec.Code != 204 {
		t.Errorf("settings %d %s", rec.Code, rec.Body)
	}
	_ = json.Unmarshal(h.do("GET", "/api/me", "", nil).Body.Bytes(), &m)
	if string(m.Settings) != `{"ftp":270,"lthr":168}` {
		t.Errorf("settings round trip %s", m.Settings)
	}

	if rec := h.do("POST", "/api/auth/logout", "", ok); rec.Code != 204 || h.cookie != nil {
		t.Errorf("logout %d cookie %v", rec.Code, h.cookie)
	}
	h.cookie = c // replaying the old cookie must fail
	if rec := h.do("GET", "/api/me", "", nil); rec.Code != 401 {
		t.Errorf("after logout %d", rec.Code)
	}
}

func TestWithoutProfileScopeSkipsDetails(t *testing.T) {
	h := newHarness(t)
	rec := h.do("POST", "/api/auth/strava", `{"code":"abc","scope":"read"}`, ok)
	var m me
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	if m.Athlete.FTP != 0 || m.CanUpload {
		t.Errorf("read-only scope %+v", m)
	}
}

func TestCSRFAndErrors(t *testing.T) {
	h := newHarness(t)
	body := `{"code":"abc","scope":"read"}`
	if rec := h.do("POST", "/api/auth/strava", body, nil); rec.Code != 403 {
		t.Errorf("no X-BBE header: %d", rec.Code)
	}
	if rec := h.do("POST", "/api/auth/strava", body, map[string]string{"X-BBE": "1", "Origin": "https://evil.example"}); rec.Code != 403 {
		t.Errorf("foreign origin: %d", rec.Code)
	}
	if rec := h.do("POST", "/api/auth/strava", `{"code":"bad"}`, ok); rec.Code != 502 {
		t.Errorf("strava rejection: %d", rec.Code)
	}
	if rec := h.do("GET", "/api/me", "", nil); rec.Code != 401 {
		t.Errorf("anonymous me: %d", rec.Code)
	}
}

func TestSessionsExpire(t *testing.T) {
	h := newHarness(t)
	h.do("POST", "/api/auth/strava", `{"code":"abc","scope":"read"}`, ok)
	// Jump past the session TTL.
	app := New(Config{Origins: []string{origin}}, h.store, nil)
	app.now = func() time.Time { return time.Now().Add(sessionTTL + time.Hour) }
	h.h = app.Handler()
	if rec := h.do("GET", "/api/me", "", nil); rec.Code != 401 {
		t.Errorf("expired session: %d", rec.Code)
	}
}

func TestDeleteAccount(t *testing.T) {
	h := newHarness(t)
	h.do("POST", "/api/auth/strava", `{"code":"abc","scope":"read,activity:write"}`, ok)
	if rec := h.do("DELETE", "/api/me", "", ok); rec.Code != 204 {
		t.Fatalf("delete %d %s", rec.Code, rec.Body)
	}
	if h.deauths.Load() != 1 {
		t.Error("Strava access revoked")
	}
	if a, _ := h.store.GetAthlete(context.Background(), 42); a != nil {
		t.Error("athlete data deleted")
	}
}

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	New(Config{Version: "test"}, store.NewMemory(), nil).Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("health %d %v", rec.Code, rec.Header())
	}
}
