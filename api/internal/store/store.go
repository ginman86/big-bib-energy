// Package store persists athletes, their Strava tokens, and sessions.
package store

import (
	"context"
	"time"
)

// Athlete is keyed by Strava athlete ID. Strava tokens live only here, server-side.
type Athlete struct {
	ID        int64     `dynamodbav:"athleteId"`
	Firstname string    `dynamodbav:"firstname"`
	Lastname  string    `dynamodbav:"lastname"`
	FTP       int       `dynamodbav:"ftp,omitempty"`
	WeightKg  float64   `dynamodbav:"weightKg,omitempty"`
	Scopes    string    `dynamodbav:"scopes"`
	Access    string    `dynamodbav:"stravaAccess"`
	Refresh   string    `dynamodbav:"stravaRefresh"`
	ExpiresAt int64     `dynamodbav:"stravaExpiresAt"`
	Settings  JSONText  `dynamodbav:"settings,omitempty"` // app settings JSON (FTP, LTHR, rider…)
	CreatedAt time.Time `dynamodbav:"createdAt"`
	UpdatedAt time.Time `dynamodbav:"updatedAt"`
}

// Ride is one completed ride. The .fit file lives in blob storage under FitKey.
type Ride struct {
	AthleteID int64     `dynamodbav:"athleteId"`
	ID        string    `dynamodbav:"rideId"`
	StartedAt time.Time `dynamodbav:"startedAt"`
	Name      string    `dynamodbav:"name"`
	Summary   JSONText  `dynamodbav:"summary"` // the app's RideSummary, without per-block detail
	FitKey    string    `dynamodbav:"fitKey"`
	// Strava upload state.
	StravaUploadID   int64     `dynamodbav:"stravaUploadId,omitempty"`
	StravaActivityID int64     `dynamodbav:"stravaActivityId,omitempty"`
	StravaError      string    `dynamodbav:"stravaError,omitempty"`
	CreatedAt        time.Time `dynamodbav:"createdAt"`
	UpdatedAt        time.Time `dynamodbav:"updatedAt"`
}

// CustomWorkout is a rider's own workout. Deleted ones stay as tombstones so a stale device can't
// resurrect them; the newest UpdatedAt wins when devices sync.
type CustomWorkout struct {
	AthleteID int64     `dynamodbav:"athleteId"`
	ID        string    `dynamodbav:"workoutId"`
	Data      JSONText  `dynamodbav:"data"` // the app's Workout JSON
	Deleted   bool      `dynamodbav:"deleted,omitempty"`
	UpdatedAt time.Time `dynamodbav:"updatedAt"`
}

type Store interface {
	ListWorkouts(ctx context.Context, athleteID int64) ([]CustomWorkout, error)
	GetWorkout(ctx context.Context, athleteID int64, id string) (*CustomWorkout, error)
	PutWorkout(ctx context.Context, w *CustomWorkout) error

	PutRide(ctx context.Context, r *Ride) error
	// PutRideIfAbsent writes the ride only if it doesn't exist; reports whether it was written.
	PutRideIfAbsent(ctx context.Context, r *Ride) (bool, error)
	// GetRide returns nil, nil when not found.
	GetRide(ctx context.Context, athleteID int64, startedAt time.Time, id string) (*Ride, error)
	// ListRides returns rides started at or after since, oldest first.
	ListRides(ctx context.Context, athleteID int64, since time.Time) ([]Ride, error)

	// GetAthlete returns nil, nil when not found.
	GetAthlete(ctx context.Context, id int64) (*Athlete, error)
	PutAthlete(ctx context.Context, a *Athlete) error
	// DeleteAthlete removes the athlete and everything stored under them.
	DeleteAthlete(ctx context.Context, id int64) error

	// Sessions are stored by the SHA-256 of the cookie value, never the value itself.
	PutSession(ctx context.Context, hash string, athleteID int64, expires time.Time) error
	// GetSession returns ok=false for missing or expired sessions.
	GetSession(ctx context.Context, hash string, now time.Time) (athleteID int64, ok bool, err error)
	DeleteSession(ctx context.Context, hash string) error
}
