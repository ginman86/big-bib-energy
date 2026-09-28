package store

import (
	"context"
	"testing"
	"time"
)

func TestMemorySessionsExpire(t *testing.T) {
	m, ctx := NewMemory(), context.Background()
	now := time.Unix(1_000_000, 0)
	_ = m.PutSession(ctx, "h", 42, now.Add(time.Hour))
	if id, ok, _ := m.GetSession(ctx, "h", now); !ok || id != 42 {
		t.Error("live session")
	}
	if _, ok, _ := m.GetSession(ctx, "h", now.Add(2*time.Hour)); ok {
		t.Error("expired session must not validate")
	}
}

func TestMemoryDeleteAthleteRemovesSessions(t *testing.T) {
	m, ctx := NewMemory(), context.Background()
	now := time.Now()
	_ = m.PutAthlete(ctx, &Athlete{ID: 7, Firstname: "A"})
	_ = m.PutSession(ctx, "h", 7, now.Add(time.Hour))
	_ = m.DeleteAthlete(ctx, 7)
	if a, _ := m.GetAthlete(ctx, 7); a != nil {
		t.Error("athlete deleted")
	}
	if _, ok, _ := m.GetSession(ctx, "h", now); ok {
		t.Error("sessions deleted with athlete")
	}
}
