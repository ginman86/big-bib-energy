package app

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"time"

	"github.com/ginman86/big-bib-energy/api/internal/store"
)

const maxWorkoutBytes = 64 << 10

var workoutID = regexp.MustCompile(`^custom-[a-z0-9-]{1,80}$`)

type workoutItem struct {
	ID        string          `json:"id"`
	Workout   json.RawMessage `json:"workout,omitempty"`
	Deleted   bool            `json:"deleted,omitempty"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func (a *App) listWorkouts(w http.ResponseWriter, r *http.Request, s athleteCtx) {
	ws, err := a.store.ListWorkouts(r.Context(), s.athlete.ID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	out := make([]workoutItem, len(ws))
	for i, cw := range ws {
		out[i] = workoutItem{ID: cw.ID, Deleted: cw.Deleted, UpdatedAt: cw.UpdatedAt}
		if !cw.Deleted {
			out[i].Workout = json.RawMessage(cw.Data)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"workouts": out})
}

type putWorkoutRequest struct {
	Workout   json.RawMessage `json:"workout"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// putWorkout creates or updates a workout. Last write wins by the client's updatedAt, so an
// older copy from a stale device can't overwrite (or un-delete) a newer one.
func (a *App) putWorkout(w http.ResponseWriter, r *http.Request, s athleteCtx) {
	id := r.PathValue("id")
	if !workoutID.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid workout id")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxWorkoutBytes+1))
	var req putWorkoutRequest
	if err != nil || len(body) > maxWorkoutBytes || json.Unmarshal(body, &req) != nil || !json.Valid(req.Workout) || req.UpdatedAt.IsZero() {
		writeError(w, http.StatusBadRequest, "workout must be JSON under 64 KB with an updatedAt")
		return
	}
	a.saveWorkout(w, r, &store.CustomWorkout{AthleteID: s.athlete.ID, ID: id, Data: store.JSONText(req.Workout), UpdatedAt: req.UpdatedAt})
}

func (a *App) deleteWorkout(w http.ResponseWriter, r *http.Request, s athleteCtx) {
	id := r.PathValue("id")
	if !workoutID.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid workout id")
		return
	}
	at := a.now()
	if v := r.URL.Query().Get("at"); v != "" {
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			at = t
		}
	}
	a.saveWorkout(w, r, &store.CustomWorkout{AthleteID: s.athlete.ID, ID: id, Deleted: true, UpdatedAt: at})
}

func (a *App) saveWorkout(w http.ResponseWriter, r *http.Request, next *store.CustomWorkout) {
	cur, err := a.store.GetWorkout(r.Context(), next.AthleteID, next.ID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if cur != nil && !next.UpdatedAt.After(cur.UpdatedAt) {
		// Stale: keep what we have and tell the client.
		writeJSON(w, http.StatusConflict, map[string]any{"error": "a newer version exists", "updatedAt": cur.UpdatedAt})
		return
	}
	if err := a.store.PutWorkout(r.Context(), next); err != nil {
		a.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
