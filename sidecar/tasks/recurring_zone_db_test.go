package tasks

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"retrospend-sidecar/db"
)

// TestProcessRecurringStepsInUserZone runs the real task against a migrated
// test database (see TestProcessRecurringPostsMoneyIn for how it skips). The
// due dates are in the past so the job picks them up; all are monthly with no
// stored anchor, the case where the job has to read the day itself.
func TestProcessRecurringStepsInUserZone(t *testing.T) {
	url := os.Getenv("SIDECAR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("SIDECAR_TEST_DATABASE_URL not set")
	}
	if !strings.Contains(url, "/retrospend_test") {
		t.Fatalf("SIDECAR_TEST_DATABASE_URL must name a retrospend_test database")
	}
	t.Setenv("DEFAULT_TIME_ZONE", "")
	ctx := context.Background()
	database, err := db.Connect(url)
	if err != nil {
		t.Fatal(err)
	}
	// Registered first, so it runs after the row cleanups below.
	t.Cleanup(database.Close)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	stamp := time.Now().Format("20060102150405.000000000")
	cases := []struct {
		name      string
		zone      *string
		direction string
		due       string
		wantNext  string
		wantDate  string // the posted entry is dated the due date it settled
		wantAnch  int
	}{
		// Jan 31 Auckland midnight is Jan 30 11:00Z: the UTC day is 30.
		{"auckland", ptr("Pacific/Auckland"), "OUT", "2026-01-30T11:00:00Z", "2026-02-27T11:00:00Z", "2026-01-30T11:00:00Z", 31},
		{"buenosaires", ptr("America/Argentina/Buenos_Aires"), "OUT", "2026-01-31T03:00:00Z", "2026-02-28T03:00:00Z", "2026-01-31T03:00:00Z", 31},
		// No stored zone: the server's default, Buenos Aires.
		{"unset", nil, "OUT", "2026-01-31T03:00:00Z", "2026-02-28T03:00:00Z", "2026-01-31T03:00:00Z", 31},
		// Income is a UTC day whatever the zone.
		{"income", ptr("Pacific/Auckland"), "IN", "2026-01-31T00:00:00Z", "2026-02-28T00:00:00Z", "2026-01-31T00:00:00Z", 31},
	}
	for _, c := range cases {
		userID := "sidecar-zone-" + c.name + stamp
		exec(`INSERT INTO "user" (id, name, username, email, "timeZone") VALUES ($1::text, $1::text, $1::text, $1::text || '@sidecar-test.invalid', $2)`, userID, c.zone)
		t.Cleanup(func() { database.Pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, userID) })
		exec(`INSERT INTO recurring_template (id, "userId", name, amount, currency, frequency, "nextDueDate", direction, "amountMode", "autoPay", "updatedAt")
			VALUES ($1::text, $1::text, $1::text, 10, 'USD', 'MONTHLY', $2, $3::"ExpenseDirection", 'FIXED', true, NOW())`,
			userID, instant(c.due), c.direction)
	}

	if err := ProcessRecurringExpenses(database); err != nil {
		t.Fatal(err)
	}

	for _, c := range cases {
		userID := "sidecar-zone-" + c.name + stamp
		var next, date time.Time
		var anchor int
		if err := database.Pool.QueryRow(ctx, `SELECT "nextDueDate", "anchorDay" FROM recurring_template WHERE id = $1`, userID).Scan(&next, &anchor); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if iso(next) != c.wantNext || anchor != c.wantAnch {
			t.Errorf("%s: next %s anchor %d, want %s anchor %d", c.name, iso(next), anchor, c.wantNext, c.wantAnch)
		}
		if err := database.Pool.QueryRow(ctx, `SELECT date FROM expense WHERE "userId" = $1`, userID).Scan(&date); err != nil {
			t.Fatalf("%s: no entry: %v", c.name, err)
		}
		if iso(date) != c.wantDate {
			t.Errorf("%s: entry dated %s, want %s", c.name, iso(date), c.wantDate)
		}
	}
}

func ptr(s string) *string { return &s }
