package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	New(Config{Version: "test"}).Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusOK || body["ok"] != true || body["version"] != "test" {
		t.Errorf("health: %d %v", rec.Code, body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("API responses must not be cached by CloudFront")
	}
}

func TestUnknownRoute(t *testing.T) {
	rec := httptest.NewRecorder()
	New(Config{}).Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/api/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("got %d", rec.Code)
	}
}
