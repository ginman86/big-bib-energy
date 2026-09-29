package app

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/ginman86/big-bib-energy/api/internal/store"
)

// customKind describes one kind of rider-made item that syncs between devices: custom workouts
// and imported (GPX) courses share the same last-write-wins rules and tombstones.
type customKind struct {
	kind     string // store kind
	field    string // JSON field for one item: "workout" / "course"
	list     string // JSON field for the list: "workouts" / "courses"
	id       *regexp.Regexp
	maxBytes int
}

var (
	workoutsKind = customKind{store.KindWorkout, "workout", "workouts", regexp.MustCompile(`^custom-[a-z0-9-]{1,80}$`), 64 << 10}
	// Courses carry a sampled elevation profile and track, so they're bigger (DynamoDB items max out at 400 KB).
	coursesKind = customKind{store.KindCourse, "course", "courses", regexp.MustCompile(`^gpx-[a-z0-9-]{1,80}$`), 256 << 10}
)

func (a *App) listCustom(k customKind) func(http.ResponseWriter, *http.Request, athleteCtx) {
	return func(w http.ResponseWriter, r *http.Request, s athleteCtx) {
		items, err := a.store.ListCustom(r.Context(), s.athlete.ID, k.kind)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		out := make([]map[string]any, len(items))
		for i, it := range items {
			out[i] = map[string]any{"id": it.ID, "updatedAt": it.UpdatedAt}
			if it.Deleted {
				out[i]["deleted"] = true
			} else {
				out[i][k.field] = json.RawMessage(it.Data)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{k.list: out})
	}
}

// putCustom creates or updates an item. Last write wins by the client's updatedAt, so an older copy
// from a stale device can't overwrite (or un-delete) a newer one.
func (a *App) putCustom(k customKind) func(http.ResponseWriter, *http.Request, athleteCtx) {
	return func(w http.ResponseWriter, r *http.Request, s athleteCtx) {
		id := r.PathValue("id")
		if !k.id.MatchString(id) {
			writeError(w, http.StatusBadRequest, "invalid "+k.field+" id")
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, int64(k.maxBytes)+1))
		var req map[string]json.RawMessage
		if err != nil || len(body) > k.maxBytes || json.Unmarshal(body, &req) != nil || !json.Valid(req[k.field]) {
			writeError(w, http.StatusBadRequest, k.field+" must be JSON under "+strconv.Itoa(k.maxBytes>>10)+" KB with an updatedAt")
			return
		}
		var at time.Time
		if json.Unmarshal(req["updatedAt"], &at) != nil || at.IsZero() {
			writeError(w, http.StatusBadRequest, k.field+" must be JSON under "+strconv.Itoa(k.maxBytes>>10)+" KB with an updatedAt")
			return
		}
		a.saveCustom(w, r, &store.CustomItem{Kind: k.kind, AthleteID: s.athlete.ID, ID: id, Data: store.JSONText(req[k.field]), UpdatedAt: at})
	}
}

func (a *App) deleteCustom(k customKind) func(http.ResponseWriter, *http.Request, athleteCtx) {
	return func(w http.ResponseWriter, r *http.Request, s athleteCtx) {
		id := r.PathValue("id")
		if !k.id.MatchString(id) {
			writeError(w, http.StatusBadRequest, "invalid "+k.field+" id")
			return
		}
		at := a.now()
		if v := r.URL.Query().Get("at"); v != "" {
			if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
				at = t
			}
		}
		a.saveCustom(w, r, &store.CustomItem{Kind: k.kind, AthleteID: s.athlete.ID, ID: id, Deleted: true, UpdatedAt: at})
	}
}

func (a *App) saveCustom(w http.ResponseWriter, r *http.Request, next *store.CustomItem) {
	cur, err := a.store.GetCustom(r.Context(), next.AthleteID, next.Kind, next.ID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if cur != nil && !next.UpdatedAt.After(cur.UpdatedAt) {
		// Stale: keep what we have and tell the client.
		writeJSON(w, http.StatusConflict, map[string]any{"error": "a newer version exists", "updatedAt": cur.UpdatedAt})
		return
	}
	if err := a.store.PutCustom(r.Context(), next); err != nil {
		a.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
