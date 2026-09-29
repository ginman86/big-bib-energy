package store

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Memory is an in-process Store for local dev and tests.
type Memory struct {
	mu       sync.Mutex
	athletes map[int64]Athlete
	sessions map[string]memSession
	rides    map[string]Ride
	workouts map[string]CustomWorkout
}

type memSession struct {
	athleteID int64
	expires   time.Time
}

func NewMemory() *Memory {
	return &Memory{athletes: map[int64]Athlete{}, sessions: map[string]memSession{}}
}

func (m *Memory) GetAthlete(_ context.Context, id int64) (*Athlete, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.athletes[id]
	if !ok {
		return nil, nil
	}
	return &a, nil
}

func (m *Memory) PutAthlete(_ context.Context, a *Athlete) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.athletes[a.ID] = *a
	return nil
}

func (m *Memory) DeleteAthlete(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.athletes, id)
	for k, r := range m.rides {
		if r.AthleteID == id {
			delete(m.rides, k)
		}
	}
	for k, w := range m.workouts {
		if w.AthleteID == id {
			delete(m.workouts, k)
		}
	}
	for h, s := range m.sessions {
		if s.athleteID == id {
			delete(m.sessions, h)
		}
	}
	return nil
}

func (m *Memory) PutSession(_ context.Context, hash string, athleteID int64, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[hash] = memSession{athleteID, expires}
	return nil
}

func (m *Memory) GetSession(_ context.Context, hash string, now time.Time) (int64, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[hash]
	if !ok || !now.Before(s.expires) {
		return 0, false, nil
	}
	return s.athleteID, true, nil
}

func (m *Memory) DeleteSession(_ context.Context, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, hash)
	return nil
}

func rideKey(athleteID int64, startedAt time.Time, id string) string {
	return fmtInt(athleteID) + "|" + rideSK(startedAt, id)
}

func (m *Memory) PutRide(_ context.Context, r *Ride) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rides == nil {
		m.rides = map[string]Ride{}
	}
	m.rides[rideKey(r.AthleteID, r.StartedAt, r.ID)] = *r
	return nil
}

func (m *Memory) PutRideIfAbsent(_ context.Context, r *Ride) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rides == nil {
		m.rides = map[string]Ride{}
	}
	k := rideKey(r.AthleteID, r.StartedAt, r.ID)
	if _, ok := m.rides[k]; ok {
		return false, nil
	}
	m.rides[k] = *r
	return true, nil
}

func (m *Memory) GetRide(_ context.Context, athleteID int64, startedAt time.Time, id string) (*Ride, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rides[rideKey(athleteID, startedAt, id)]
	if !ok {
		return nil, nil
	}
	return &r, nil
}

func (m *Memory) ListRides(_ context.Context, athleteID int64, since time.Time) ([]Ride, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Ride
	for _, r := range m.rides {
		if r.AthleteID == athleteID && !r.StartedAt.Before(since) {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return rideSK(out[i].StartedAt, out[i].ID) < rideSK(out[j].StartedAt, out[j].ID) })
	return out, nil
}

func workoutKey(athleteID int64, id string) string { return fmtInt(athleteID) + "|" + id }

func (m *Memory) ListWorkouts(_ context.Context, athleteID int64) ([]CustomWorkout, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []CustomWorkout
	for _, w := range m.workouts {
		if w.AthleteID == athleteID {
			out = append(out, w)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (m *Memory) GetWorkout(_ context.Context, athleteID int64, id string) (*CustomWorkout, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w, ok := m.workouts[workoutKey(athleteID, id)]
	if !ok {
		return nil, nil
	}
	return &w, nil
}

func (m *Memory) PutWorkout(_ context.Context, w *CustomWorkout) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.workouts == nil {
		m.workouts = map[string]CustomWorkout{}
	}
	m.workouts[workoutKey(w.AthleteID, w.ID)] = *w
	return nil
}
