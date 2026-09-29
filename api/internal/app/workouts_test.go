package app

import (
	"strings"
	"testing"
)

func TestWorkoutSyncLastWriteWins(t *testing.T) {
	h, _, _ := rideHarness(t, "ok", "read")
	put := func(id, name, at string) int {
		return h.do("PUT", "/api/workouts/"+id, `{"workout":{"name":"`+name+`","steps":[]},"updatedAt":"`+at+`"}`, ok).Code
	}
	if c := put("custom-threshold-abc", "v1", "2026-09-28T10:00:00Z"); c != 204 {
		t.Fatalf("create %d", c)
	}
	if c := put("custom-threshold-abc", "v2", "2026-09-28T11:00:00Z"); c != 204 {
		t.Fatalf("update %d", c)
	}
	// A stale device's older copy is refused.
	if c := put("custom-threshold-abc", "stale", "2026-09-28T10:30:00Z"); c != 409 {
		t.Errorf("stale write should conflict, got %d", c)
	}
	list := h.do("GET", "/api/workouts", "", nil).Body.String()
	if !strings.Contains(list, `"name":"v2"`) || strings.Contains(list, "stale") {
		t.Errorf("list %s", list)
	}

	// Delete leaves a tombstone; an older edit can't resurrect it.
	if c := h.do("DELETE", "/api/workouts/custom-threshold-abc?at=2026-09-28T12:00:00Z", "", ok).Code; c != 204 {
		t.Fatalf("delete %d", c)
	}
	if c := put("custom-threshold-abc", "zombie", "2026-09-28T11:30:00Z"); c != 409 {
		t.Errorf("resurrection should conflict, got %d", c)
	}
	list = h.do("GET", "/api/workouts", "", nil).Body.String()
	if !strings.Contains(list, `"deleted":true`) || strings.Contains(list, "zombie") || strings.Contains(list, `"workout"`) {
		t.Errorf("tombstone %s", list)
	}
}

func TestWorkoutValidation(t *testing.T) {
	h, _, _ := rideHarness(t, "ok", "read")
	// Only our own "custom-…" IDs are accepted (built-in workout IDs can't be overwritten).
	for _, id := range []string{"sweet-spot-3x10", "custom-UPPER", "custom-"} {
		if c := h.do("PUT", "/api/workouts/"+id, `{"workout":{},"updatedAt":"2026-09-28T10:00:00Z"}`, ok).Code; c != 400 {
			t.Errorf("bad id %q: %d", id, c)
		}
	}
	if c := h.do("PUT", "/api/workouts/custom-x", `{"workout":{}}`, ok).Code; c != 400 {
		t.Errorf("missing updatedAt %d", c)
	}
	if c := h.do("PUT", "/api/workouts/custom-x", `{"workout":{},"updatedAt":"2026-09-28T10:00:00Z"}`, nil).Code; c != 403 {
		t.Errorf("csrf %d", c)
	}
}
