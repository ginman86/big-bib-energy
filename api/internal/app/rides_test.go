package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ginman86/big-bib-energy/api/internal/store"
	"github.com/ginman86/big-bib-energy/api/internal/strava"
)

// uploadStrava is a fake Strava with the upload endpoints. mode: "ok" | "duplicate" | "reject".
type uploadStrava struct {
	mode    string
	uploads atomic.Int32
}

func (u *uploadStrava) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/oauth/token":
		_, _ = w.Write([]byte(`{"access_token":"at","refresh_token":"rt","expires_at":4000000000,"athlete":{"id":42,"firstname":"G","lastname":"I"}}`))
	case r.Method == "POST" && r.URL.Path == "/api/v3/uploads":
		u.uploads.Add(1)
		_ = r.ParseMultipartForm(1 << 20)
		if r.FormValue("external_id") == "" || r.FormValue("trainer") != "1" {
			http.Error(w, "bad form", 400)
			return
		}
		_, _ = w.Write([]byte(`{"id":99,"status":"Your activity is still being processed."}`))
	case r.URL.Path == "/api/v3/uploads/99":
		switch u.mode {
		case "duplicate":
			_, _ = w.Write([]byte(`{"id":99,"error":"bbe-x.fit duplicate of <a href='/activities/777'>Ride</a>","status":"There was an error processing your activity."}`))
		case "reject":
			_, _ = w.Write([]byte(`{"id":99,"error":"Improperly formatted data.","status":"There was an error processing your activity."}`))
		default:
			_, _ = w.Write([]byte(`{"id":99,"status":"Your activity is ready.","activity_id":555}`))
		}
	default:
		http.NotFound(w, r)
	}
}

func rideHarness(t *testing.T, mode, scope string) (*harness, *uploadStrava, *store.MemoryBlobs) {
	fake := &uploadStrava{mode: mode}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	sc := strava.New("1", func(context.Context) (string, error) { return "s", nil })
	sc.BaseURL = srv.URL
	mem, blobs := store.NewMemory(), store.NewMemoryBlobs()
	app := New(Config{Origins: []string{origin}}, mem, blobs, sc)
	app.poll = time.Millisecond
	h := &harness{t: t, h: app.Handler(), store: mem}
	if rec := h.do("POST", "/api/auth/strava", fmt.Sprintf(`{"code":"c","scope":%q}`, scope), ok); rec.Code != 200 {
		t.Fatalf("sign in %d", rec.Code)
	}
	return h, fake, blobs
}

const rideUUID = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"

func rideBody(id string) string {
	fit := base64.StdEncoding.EncodeToString(append([]byte{14, 0x20, 0, 0, 0, 0, 0, 0}, []byte(".FIT....")...))
	return fmt.Sprintf(`{"id":%q,"startedAt":"2026-09-28T06:30:00Z","name":"Sweet Spot 3×10 · 94%% on target",
		"description":"Dialled in.","summary":{"tss":45},"fit":%q}`, id, fit)
}

func postRide(t *testing.T, h *harness, body string) (int, rideResponse) {
	t.Helper()
	rec := h.do("POST", "/api/rides", body, ok)
	var res rideResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	return rec.Code, res
}

func TestRideUploadsToStravaOnce(t *testing.T) {
	h, fake, blobs := rideHarness(t, "ok", "read,activity:write")
	code, res := postRide(t, h, rideBody(rideUUID))
	if code != 200 || res.Strava.Status != "uploaded" || res.Strava.ActivityID != 555 ||
		res.Strava.URL != "https://www.strava.com/activities/555" {
		t.Fatalf("upload %d %+v", code, res)
	}
	if _, ok := blobs.Items["rides/42/"+rideUUID+".fit"]; !ok {
		t.Error(".fit stored")
	}
	// Retrying (e.g. the response was lost) must not upload again.
	_, again := postRide(t, h, rideBody(rideUUID))
	if again.Strava.ActivityID != 555 || fake.uploads.Load() != 1 {
		t.Errorf("idempotent retry: %+v uploads=%d", again, fake.uploads.Load())
	}
	rec := h.do("GET", "/api/rides", "", nil)
	if !strings.Contains(rec.Body.String(), `"stravaActivityId":555`) || !strings.Contains(rec.Body.String(), `"tss":45`) {
		t.Errorf("list %s", rec.Body)
	}
}

func TestRideDuplicateLinksExistingActivity(t *testing.T) {
	h, _, _ := rideHarness(t, "duplicate", "read,activity:write")
	_, res := postRide(t, h, rideBody(rideUUID))
	if res.Strava.Status != "uploaded" || res.Strava.ActivityID != 777 {
		t.Errorf("duplicate: %+v", res)
	}
}

func TestRideRejectedAndNotConnected(t *testing.T) {
	h, _, _ := rideHarness(t, "reject", "read,activity:write")
	if _, res := postRide(t, h, rideBody(rideUUID)); res.Strava.Status != "failed" || res.Strava.Error != "Improperly formatted data." {
		t.Errorf("rejected: %+v", res)
	}
	h2, fake, _ := rideHarness(t, "ok", "read")
	if _, res := postRide(t, h2, rideBody(rideUUID)); res.Strava.Status != "not-connected" || fake.uploads.Load() != 0 {
		t.Errorf("no write scope: %+v", res)
	}
}

func TestRideValidation(t *testing.T) {
	h, _, _ := rideHarness(t, "ok", "read,activity:write")
	if code, _ := postRide(t, h, rideBody("not-a-uuid")); code != 400 {
		t.Errorf("bad id: %d", code)
	}
	bad := strings.Replace(rideBody(rideUUID), `"fit":"`, `"fit":"AAAA`, 1)
	if code, _ := postRide(t, h, bad); code != 400 {
		t.Errorf("bad fit: %d", code)
	}
}

func TestImportHistoryIsIdempotentAndNeverUploads(t *testing.T) {
	h, fake, _ := rideHarness(t, "ok", "read,activity:write")
	body := `{"rides":[
		{"id":"11111111-1111-4111-8111-111111111111","startedAt":"2026-09-20T06:00:00Z","name":"Shakeout","summary":{"tss":8}},
		{"id":"22222222-2222-4222-8222-222222222222","startedAt":"2026-09-21T06:00:00Z","name":"Sweet Spot 3×10","summary":{"tss":60}}]}`
	rec := h.do("POST", "/api/rides/import", body, ok)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"imported":2`) {
		t.Fatalf("import %d %s", rec.Code, rec.Body)
	}
	if rec := h.do("POST", "/api/rides/import", body, ok); !strings.Contains(rec.Body.String(), `"imported":0`) {
		t.Errorf("re-import should skip existing: %s", rec.Body)
	}
	if fake.uploads.Load() != 0 {
		t.Error("imported history must never go to Strava")
	}
	list := h.do("GET", "/api/rides", "", nil).Body.String()
	if !strings.Contains(list, "Shakeout") || !strings.Contains(list, `"tss":60`) {
		t.Errorf("list %s", list)
	}
	// An uploaded ride isn't overwritten by an import of the same ID.
	postRide(t, h, rideBody(rideUUID))
	h.do("POST", "/api/rides/import", `{"rides":[{"id":"`+rideUUID+`","startedAt":"2026-09-28T06:30:00Z","name":"x","summary":{}}]}`, ok)
	if !strings.Contains(h.do("GET", "/api/rides", "", nil).Body.String(), `"stravaActivityId":555`) {
		t.Error("import clobbered an uploaded ride")
	}
	if rec := h.do("POST", "/api/rides/import", `{"rides":[{"id":"nope","startedAt":"2026-09-20T06:00:00Z","summary":{}}]}`, ok); rec.Code != 400 {
		t.Errorf("bad id %d", rec.Code)
	}
}
