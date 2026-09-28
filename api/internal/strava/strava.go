// Package strava is a minimal Strava API client: OAuth token exchange/refresh, the athlete
// profile, deauthorization, and activity uploads.
package strava

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// SecretFunc returns the client secret (loaded lazily, e.g. from SSM, and cached by the caller).
type SecretFunc func(ctx context.Context) (string, error)

type Client struct {
	ClientID string
	Secret   SecretFunc
	HTTP     *http.Client
	// BaseURL is https://www.strava.com; overridden in tests.
	BaseURL string
}

func New(clientID string, secret SecretFunc) *Client {
	return &Client{ClientID: clientID, Secret: secret, HTTP: &http.Client{Timeout: 15 * time.Second}, BaseURL: "https://www.strava.com"}
}

type Athlete struct {
	ID        int64    `json:"id"`
	Firstname string   `json:"firstname"`
	Lastname  string   `json:"lastname"`
	FTP       *int     `json:"ftp"`    // needs profile:read_all
	Weight    *float64 `json:"weight"` // kg, needs profile:read_all
}

type Token struct {
	AccessToken  string   `json:"access_token"`
	RefreshToken string   `json:"refresh_token"`
	ExpiresAt    int64    `json:"expires_at"`
	Athlete      *Athlete `json:"athlete,omitempty"` // only on code exchange
}

// Error is a non-2xx response from Strava.
type Error struct {
	Status int
	Body   string
}

func (e *Error) Error() string { return fmt.Sprintf("strava: HTTP %d: %s", e.Status, e.Body) }

// Exchange trades an OAuth authorization code for tokens and the athlete summary.
func (c *Client) Exchange(ctx context.Context, code string) (Token, error) {
	return c.token(ctx, url.Values{"code": {code}, "grant_type": {"authorization_code"}})
}

// Refresh gets a new access token. Strava may rotate the refresh token too.
func (c *Client) Refresh(ctx context.Context, refreshToken string) (Token, error) {
	return c.token(ctx, url.Values{"refresh_token": {refreshToken}, "grant_type": {"refresh_token"}})
}

func (c *Client) token(ctx context.Context, form url.Values) (Token, error) {
	secret, err := c.Secret(ctx)
	if err != nil {
		return Token{}, fmt.Errorf("strava secret: %w", err)
	}
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", secret)
	var t Token
	err = c.do(ctx, http.MethodPost, "/oauth/token", "", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", &t)
	return t, err
}

func (c *Client) Athlete(ctx context.Context, accessToken string) (Athlete, error) {
	var a Athlete
	err := c.do(ctx, http.MethodGet, "/api/v3/athlete", accessToken, nil, "", &a)
	return a, err
}

// Deauthorize revokes the app's access for this athlete.
func (c *Client) Deauthorize(ctx context.Context, accessToken string) error {
	return c.do(ctx, http.MethodPost, "/oauth/deauthorize", accessToken, nil, "", nil)
}

func (c *Client) do(ctx context.Context, method, path, bearer string, body io.Reader, contentType string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return err
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode/100 != 2 {
		return &Error{Status: res.StatusCode, Body: string(b)}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(b, out)
}

// Expired reports whether an access token needs refreshing (with a 5-minute margin).
func Expired(expiresAt int64, now time.Time) bool {
	return now.Add(5*time.Minute).Unix() >= expiresAt
}

// ParseScopes splits Strava's comma-separated granted scope list.
func ParseScopes(s string) map[string]bool {
	out := map[string]bool{}
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out[p] = true
		}
	}
	return out
}

// IDString formats an athlete ID for keys.
func IDString(id int64) string { return strconv.FormatInt(id, 10) }
