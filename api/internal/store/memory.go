package store

import (
	"context"
	"sync"
	"time"
)

// Memory is an in-process Store for local dev and tests.
type Memory struct {
	mu       sync.Mutex
	athletes map[int64]Athlete
	sessions map[string]memSession
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
