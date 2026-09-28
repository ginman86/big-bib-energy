package strava

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestUploadAndPoll(t *testing.T) {
	var polls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/v3/uploads":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Fatal(err)
			}
			f, _, _ := r.FormFile("file")
			b, _ := io.ReadAll(f)
			if string(b) != "FITDATA" || r.FormValue("data_type") != "fit" || r.FormValue("trainer") != "1" ||
				r.FormValue("external_id") != "bbe-1.fit" || r.FormValue("name") != "Sweet Spot" {
				t.Errorf("upload form %v", r.MultipartForm.Value)
			}
			_, _ = w.Write([]byte(`{"id":99,"status":"Your activity is still being processed."}`))
		case r.URL.Path == "/api/v3/uploads/99":
			if polls.Add(1) < 2 {
				_, _ = w.Write([]byte(`{"id":99,"status":"Your activity is still being processed."}`))
				return
			}
			_, _ = w.Write([]byte(`{"id":99,"status":"Your activity is ready.","activity_id":1234}`))
		}
	}))
	defer srv.Close()
	c := New("1", func(context.Context) (string, error) { return "s", nil })
	c.BaseURL = srv.URL
	u, err := c.Upload(context.Background(), "at", []byte("FITDATA"), UploadParams{Name: "Sweet Spot", ExternalID: "bbe-1.fit"})
	if err != nil {
		t.Fatal(err)
	}
	u, err = c.WaitForActivity(context.Background(), "at", u, time.Millisecond)
	if err != nil || u.ActivityID != 1234 || polls.Load() != 2 {
		t.Errorf("wait: %+v %v polls=%d", u, err, polls.Load())
	}
}

func TestDuplicateActivity(t *testing.T) {
	id, ok := DuplicateActivity(`bbe-1.fit duplicate of <a href='/activities/15500000001' target='_blank'>Sweet Spot</a>`)
	if !ok || id != 15500000001 {
		t.Errorf("got %d %v", id, ok)
	}
	if _, ok := DuplicateActivity("Improperly formatted data."); ok {
		t.Error("not a duplicate")
	}
}
