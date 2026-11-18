package tasks

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"retrospend-sidecar/db"
)

// TestRetentionCleanupPurgesExpiredResetLinks runs the real retention job on a
// migrated test database and skips unless SIDECAR_TEST_DATABASE_URL names one.
// The reset link table has a user id, an origin and a hashed token since
// migration 20261118100000_reset_token_hardening; the purge deletes by
// "expires" alone, so it must still remove an expired link of either origin and
// keep a live one.
func TestRetentionCleanupPurgesExpiredResetLinks(t *testing.T) {
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

	const userID = "reset-purge-user"
	cleanup := func() {
		database.Pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, userID)
	}
	cleanup()
	t.Cleanup(cleanup)
	if _, err := database.Pool.Exec(ctx,
		`INSERT INTO "user" (id, name, username, email) VALUES ($1, 'Reset purge', 'reset_purge_user', 'reset-purge@pg-test.invalid')`,
		userID,
	); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	links := []struct {
		token   string
		origin  string
		expires time.Time
	}{
		{"expired-email", "email", now.Add(-time.Minute)},
		{"expired-admin", "admin", now.Add(-time.Hour)},
		{"live-email", "email", now.Add(time.Hour)},
		{"live-admin", "admin", now.Add(time.Hour)},
	}
	for _, l := range links {
		if _, err := database.Pool.Exec(ctx,
			`INSERT INTO password_reset_token (token, "userId", origin, expires) VALUES ($1, $2, $3, $4)`,
			l.token, userID, l.origin, l.expires,
		); err != nil {
			t.Fatal(err)
		}
	}

	report, err := RunDataRetentionCleanup(database)
	if err != nil {
		t.Fatal(err)
	}
	if report.TokensDeleted < 2 {
		t.Fatalf("TokensDeleted = %d, want at least the 2 expired links", report.TokensDeleted)
	}

	rows, err := database.Pool.Query(ctx,
		`SELECT token FROM password_reset_token WHERE "userId" = $1 ORDER BY token`, userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var left []string
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			t.Fatal(err)
		}
		left = append(left, token)
	}
	if strings.Join(left, ",") != "live-admin,live-email" {
		t.Fatalf("links left = %v, want only the two live ones", left)
	}
}
