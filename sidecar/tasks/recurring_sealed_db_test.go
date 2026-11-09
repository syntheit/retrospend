package tasks

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"retrospend-sidecar/db"
)

// TestProcessRecurringRefusesAnEncryptedName runs the real task against a
// migrated test database (see TestProcessRecurringPostsMoneyIn for how it
// skips). A template whose name starts with U+0001 is an encrypted value that
// was not opened: it must not become an expense titled with the ciphertext,
// it must not advance, and the run must report the failure. The other
// template due in the same run still posts.
func TestProcessRecurringRefusesAnEncryptedName(t *testing.T) {
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
	// Registered first, so it runs after the row cleanups below.
	t.Cleanup(database.Close)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	userID := "sidecar-sealed-" + time.Now().Format("20060102150405.000000000")
	exec(`INSERT INTO "user" (id, name, username, email) VALUES ($1::text, $1::text, $1::text, $1::text || '@sidecar-test.invalid')`, userID)
	t.Cleanup(func() { database.Pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, userID) })

	due := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)
	template := func(id, name string) {
		exec(`INSERT INTO recurring_template (id, "userId", name, amount, currency, frequency, "nextDueDate", direction, "amountMode", "updatedAt")
			VALUES ($1::text, $2::text, $3::text, 40::numeric, 'USD', 'MONTHLY', $4, 'OUT'::"ExpenseDirection", 'FIXED'::"RecurringAmountMode", NOW())`,
			userID+id, userID, name, due)
	}
	template("-sealed", "\x01k1:AAAA")
	template("-plain", "Gym")

	runErr := ProcessRecurringExpenses(database)
	if runErr == nil {
		t.Fatal("the run must report the template it could not post")
	}
	if strings.Contains(runErr.Error(), "k1:") {
		t.Fatalf("the error repeats the encrypted text: %v", runErr)
	}

	rows, err := database.Pool.Query(ctx, `SELECT title FROM expense WHERE "userId" = $1 ORDER BY title`, userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var titles []string
	for rows.Next() {
		var title string
		if err := rows.Scan(&title); err != nil {
			t.Fatal(err)
		}
		titles = append(titles, title)
	}
	if strings.Join(titles, "|") != "Gym" {
		t.Fatalf("got titles %q, want only Gym", titles)
	}

	var next time.Time
	if err := database.Pool.QueryRow(ctx, `SELECT "nextDueDate" FROM recurring_template WHERE id = $1`, userID+"-sealed").Scan(&next); err != nil {
		t.Fatal(err)
	}
	if !next.Equal(due) {
		t.Fatalf("the refused template advanced to %v, want it left at %v", next, due)
	}
}
