package tasks

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"retrospend-sidecar/db"
)

// TestRecordRateHistory writes against a migrated test database and skips
// unless SIDECAR_TEST_DATABASE_URL names one (see recurring_db_test.go).
func TestRecordRateHistory(t *testing.T) {
	url := os.Getenv("SIDECAR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("SIDECAR_TEST_DATABASE_URL not set")
	}
	if !strings.Contains(url, "/retrospend_test") {
		t.Fatalf("SIDECAR_TEST_DATABASE_URL must name a retrospend_test database")
	}
	ctx := context.Background()
	database, err := db.Connect(url)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	day := time.Date(2031, 5, 4, 0, 0, 0, 0, time.UTC)
	cleanup := func() {
		database.Pool.Exec(ctx, `DELETE FROM exchange_rate_history WHERE currency = 'ZZZ'`)
	}
	cleanup()
	t.Cleanup(cleanup)

	first := []ParsedRate{{Currency: "ZZZ", Type: "official", Rate: 100}, {Currency: "ZZZ", Type: "blue", Rate: 120}}
	if err := recordRateHistory(ctx, database, day, first); err != nil {
		t.Fatal(err)
	}
	// A second sync the same day replaces that day's value.
	second := []ParsedRate{{Currency: "ZZZ", Type: "official", Rate: 101.5}}
	if err := recordRateHistory(ctx, database, day, second); err != nil {
		t.Fatal(err)
	}
	// The next day adds a row.
	if err := recordRateHistory(ctx, database, day.AddDate(0, 0, 1), second); err != nil {
		t.Fatal(err)
	}
	var n int
	var official float64
	if err := database.Pool.QueryRow(ctx, `SELECT count(*)::int FROM exchange_rate_history WHERE currency = 'ZZZ'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("rows = %d, want 3", n)
	}
	if err := database.Pool.QueryRow(ctx, `SELECT rate::float8 FROM exchange_rate_history WHERE currency = 'ZZZ' AND type = 'official' AND date = '2031-05-04'`).Scan(&official); err != nil {
		t.Fatal(err)
	}
	if official != 101.5 {
		t.Fatalf("official = %v, want 101.5", official)
	}
}
