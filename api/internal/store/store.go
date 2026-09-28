// Package store persists athletes, their Strava tokens, and sessions.
package store

import (
	"context"
	"encoding/json"
	"time"
)

// Athlete is keyed by Strava athlete ID. Strava tokens live only here, server-side.
type Athlete struct {
	ID        int64           `dynamodbav:"athleteId"`
	Firstname string          `dynamodbav:"firstname"`
	Lastname  string          `dynamodbav:"lastname"`
	FTP       int             `dynamodbav:"ftp,omitempty"`
	WeightKg  float64         `dynamodbav:"weightKg,omitempty"`
	Scopes    string          `dynamodbav:"scopes"`
	Access    string          `dynamodbav:"stravaAccess"`
	Refresh   string          `dynamodbav:"stravaRefresh"`
	ExpiresAt int64           `dynamodbav:"stravaExpiresAt"`
	Settings  json.RawMessage `dynamodbav:"settings,omitempty"` // app settings JSON (FTP, LTHR, rider…)
	CreatedAt time.Time       `dynamodbav:"createdAt"`
	UpdatedAt time.Time       `dynamodbav:"updatedAt"`
}

type Store interface {
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
