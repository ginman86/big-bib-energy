package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/ginman86/big-bib-energy/api/internal/store"
	"github.com/ginman86/big-bib-energy/api/internal/strava"
)

const (
	maxRideBytes = 4 << 20 // JSON incl. base64 .fit; an hour at 1 Hz is ~55 KB
	// Stay well inside CloudFront's 30 s origin timeout; clients re-POST to resume.
	uploadWait   = 15 * time.Second
	pollInterval = time.Second // Strava asks for ≥ 1 s between status polls
)

var rideID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type rideRequest struct {
	ID          string          `json:"id"`
	StartedAt   time.Time       `json:"startedAt"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Summary     json.RawMessage `json:"summary"`
	Fit         string          `json:"fit"` // base64
}

// StravaStatus is what the summary screen shows.
type StravaStatus struct {
	Status     string `json:"status"` // uploaded | processing | failed | not-connected
	ActivityID int64  `json:"activityId,omitempty"`
	URL        string `json:"url,omitempty"`
	Error      string `json:"error,omitempty"`
}

type rideResponse struct {
	ID     string       `json:"id"`
	Strava StravaStatus `json:"strava"`
}

func (a *App) postRide(w http.ResponseWriter, r *http.Request, s athleteCtx) {
	var req rideRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxRideBytes)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid ride")
		return
	}
	fit, err := base64.StdEncoding.DecodeString(req.Fit)
	switch {
	case !rideID.MatchString(req.ID), req.StartedAt.IsZero(), !json.Valid(req.Summary):
		writeError(w, http.StatusBadRequest, "invalid ride")
		return
	case err != nil || len(fit) < 14 || string(fit[8:12]) != ".FIT":
		writeError(w, http.StatusBadRequest, "fit must be a base64 FIT file")
		return
	}
	req.Name = truncate(req.Name, 200)
	req.Description = truncate(req.Description, 2000)

	ctx := r.Context()
	ride, err := a.store.GetRide(ctx, s.athlete.ID, req.StartedAt, req.ID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	now := a.now()
	if ride == nil {
		key := "rides/" + strconv.FormatInt(s.athlete.ID, 10) + "/" + req.ID + ".fit"
		if err := a.blobs.Put(ctx, key, fit, "application/vnd.ant.fit"); err != nil {
			a.fail(w, r, err)
			return
		}
		ride = &store.Ride{
			AthleteID: s.athlete.ID, ID: req.ID, StartedAt: req.StartedAt, Name: req.Name,
			Summary: store.JSONText(req.Summary), FitKey: key, CreatedAt: now,
		}
	}

	status := a.syncToStrava(ctx, s.athlete, ride, fit, req)
	ride.UpdatedAt = now
	if err := a.store.PutRide(ctx, ride); err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rideResponse{ID: ride.ID, Strava: status})
}

// syncToStrava uploads (or resumes an upload of) the ride, recording the outcome on it.
func (a *App) syncToStrava(ctx context.Context, ath *store.Athlete, ride *store.Ride, fit []byte, req rideRequest) StravaStatus {
	if ride.StravaActivityID != 0 {
		return uploaded(ride.StravaActivityID)
	}
	if !strava.ParseScopes(ath.Scopes)["activity:write"] {
		return StravaStatus{Status: "not-connected", Error: "Strava upload permission not granted"}
	}
	access, err := a.freshAccessCtx(ctx, ath)
	if err != nil {
		return a.stravaFailure(ctx, ride, err)
	}
	ctx, cancel := context.WithTimeout(ctx, uploadWait)
	defer cancel()

	var up strava.Upload
	if ride.StravaUploadID != 0 {
		// A previous request timed out while Strava was processing: resume, don't re-upload.
		up = strava.Upload{ID: ride.StravaUploadID}
	} else {
		up, err = a.strava.Upload(ctx, access, fit, strava.UploadParams{
			Name: req.Name, Description: req.Description, ExternalID: "bbe-" + ride.ID + ".fit",
		})
		if err != nil {
			return a.stravaFailure(ctx, ride, err)
		}
		ride.StravaUploadID = up.ID
	}

	up, err = a.strava.WaitForActivity(ctx, access, up, a.poll)
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return StravaStatus{Status: "processing"}
	case err != nil:
		return a.stravaFailure(ctx, ride, err)
	case up.ActivityID != 0:
		ride.StravaActivityID, ride.StravaError = up.ActivityID, ""
		return uploaded(up.ActivityID)
	}
	// Strava's duplicate detection means it's already there: link to that activity.
	if id, ok := strava.DuplicateActivity(up.Error); ok {
		ride.StravaActivityID, ride.StravaError = id, ""
		return uploaded(id)
	}
	ride.StravaError = up.Error
	ride.StravaUploadID = 0 // a rejected upload can be retried from scratch
	return StravaStatus{Status: "failed", Error: up.Error}
}

func (a *App) stravaFailure(ctx context.Context, ride *store.Ride, err error) StravaStatus {
	slog.WarnContext(ctx, "strava upload failed", "ride", ride.ID, "err", err)
	msg := "Strava upload failed"
	var se *strava.Error
	if errors.As(err, &se) && se.Status == http.StatusUnauthorized {
		msg = "Strava access was revoked — reconnect Strava"
	}
	ride.StravaError = msg
	return StravaStatus{Status: "failed", Error: msg}
}

func uploaded(id int64) StravaStatus {
	return StravaStatus{Status: "uploaded", ActivityID: id, URL: "https://www.strava.com/activities/" + strconv.FormatInt(id, 10)}
}

type rideListItem struct {
	ID               string          `json:"id"`
	StartedAt        time.Time       `json:"startedAt"`
	Name             string          `json:"name"`
	Summary          json.RawMessage `json:"summary"`
	StravaActivityID int64           `json:"stravaActivityId,omitempty"`
}

// listRides returns the athlete's rides since ?since= (RFC 3339), default all.
func (a *App) listRides(w http.ResponseWriter, r *http.Request, s athleteCtx) {
	var since time.Time
	if v := r.URL.Query().Get("since"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "since must be RFC 3339")
			return
		}
		since = t
	}
	rides, err := a.store.ListRides(r.Context(), s.athlete.ID, since)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	out := make([]rideListItem, len(rides))
	for i, rd := range rides {
		out[i] = rideListItem{rd.ID, rd.StartedAt, rd.Name, json.RawMessage(rd.Summary), rd.StravaActivityID}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rides": out})
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
