package store

import (
	"context"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
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

func TestJSONTextReadsLegacyBinary(t *testing.T) {
	var j JSONText
	if err := j.UnmarshalDynamoDBAttributeValue(&types.AttributeValueMemberB{Value: []byte(`{"ftp":230}`)}); err != nil || string(j) != `{"ftp":230}` {
		t.Errorf("legacy binary: %s %v", j, err)
	}
	av, _ := JSONText(`{"ftp":230}`).MarshalDynamoDBAttributeValue()
	if s, ok := av.(*types.AttributeValueMemberS); !ok || s.Value != `{"ftp":230}` {
		t.Errorf("writes a string: %#v", av)
	}
}

func TestMemoryRides(t *testing.T) {
	m, ctx := NewMemory(), context.Background()
	t0 := time.Date(2026, 9, 28, 6, 0, 0, 0, time.UTC)
	_ = m.PutRide(ctx, &Ride{AthleteID: 1, ID: "b", StartedAt: t0.Add(time.Hour)})
	_ = m.PutRide(ctx, &Ride{AthleteID: 1, ID: "a", StartedAt: t0})
	_ = m.PutRide(ctx, &Ride{AthleteID: 2, ID: "c", StartedAt: t0})
	rs, _ := m.ListRides(ctx, 1, t0)
	if len(rs) != 2 || rs[0].ID != "a" || rs[1].ID != "b" {
		t.Errorf("list %+v", rs)
	}
	if r, _ := m.GetRide(ctx, 1, t0, "a"); r == nil {
		t.Error("get")
	}
}
