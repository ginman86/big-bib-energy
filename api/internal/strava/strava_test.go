package strava

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestExchangeSendsCredentialsAndParsesAthlete(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.URL.Path != "/oauth/token" || r.Form.Get("client_id") != "282789" || r.Form.Get("client_secret") != "shh" ||
			r.Form.Get("code") != "abc" || r.Form.Get("grant_type") != "authorization_code" {
			t.Errorf("bad token request: %s %v", r.URL.Path, r.Form)
		}
		_, _ = w.Write([]byte(`{"access_token":"at","refresh_token":"rt","expires_at":1900000000,
			"athlete":{"id":42,"firstname":"Greg","lastname":"I","ftp":265,"weight":72.5}}`))
	}))
	defer srv.Close()
	c := New("282789", func(context.Context) (string, error) { return "shh", nil })
	c.BaseURL = srv.URL
	tok, err := c.Exchange(context.Background(), "abc")
	if err != nil {
		t.Fatal(err)
	}
	if tok.AccessToken != "at" || tok.Athlete == nil || tok.Athlete.ID != 42 || *tok.Athlete.FTP != 265 {
		t.Errorf("token %+v", tok)
	}
}

func TestErrorsCarryStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"message":"Bad Request"}`, http.StatusBadRequest)
	}))
	defer srv.Close()
	c := New("1", func(context.Context) (string, error) { return "s", nil })
	c.BaseURL = srv.URL
	_, err := c.Exchange(context.Background(), "bad")
	if e, ok := err.(*Error); !ok || e.Status != 400 {
		t.Errorf("err %v", err)
	}
}

func TestExpiredAndScopes(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	if !Expired(now.Unix()+60, now) || Expired(now.Unix()+3600, now) {
		t.Error("5-minute refresh margin")
	}
	s := ParseScopes("read,activity:write, profile:read_all")
	if !s["activity:write"] || !s["profile:read_all"] || len(s) != 3 {
		t.Errorf("scopes %v", s)
	}
}
