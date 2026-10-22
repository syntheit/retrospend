package tasks

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"retrospend-sidecar/db"
)

// TestProcessRecurringPostsMoneyIn runs the real task against a migrated
// test database. It skips unless SIDECAR_TEST_DATABASE_URL names one (a
// throwaway retrospend_test_* database after `prisma migrate deploy`),
// because it writes rows and the task reads every user's due templates.
func TestProcessRecurringPostsMoneyIn(t *testing.T) {
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

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	userID := "sidecar-test-" + time.Now().Format("20060102150405.000000000")
	exec(`INSERT INTO "user" (id, name, username, email) VALUES ($1::text, $1::text, $1::text, $1::text || '@sidecar-test.invalid')`, userID)
	t.Cleanup(func() { database.Pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, userID) })

	due := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)
	template := func(name, amount, direction, mode string) {
		exec(`INSERT INTO recurring_template (id, "userId", name, amount, currency, frequency, "nextDueDate", direction, "amountMode", "updatedAt")
			VALUES ($1::text || $2::text, $1::text, $2::text, $3::numeric, 'USD', 'MONTHLY', $4, $5::"ExpenseDirection", $6::"RecurringAmountMode", NOW())`,
			userID, name, amount, due, direction, mode)
	}
	template("Salary", "2950.12345678", "IN", "FIXED")
	template("Freelance", "850", "IN", "ASK")
	template("Gym", "40", "OUT", "FIXED")

	if err := ProcessRecurringExpenses(database); err != nil {
		t.Fatal(err)
	}

	rows, err := database.Pool.Query(ctx, `
		SELECT title, amount::text, direction::text, coalesce("inType"::text, '-'), "entryKind"::text
		FROM expense WHERE "userId" = $1 ORDER BY title`, userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var title, amount, direction, inType, kind string
		if err := rows.Scan(&title, &amount, &direction, &inType, &kind); err != nil {
			t.Fatal(err)
		}
		got = append(got, strings.Join([]string{title, amount, direction, inType, kind}, " "))
	}
	want := []string{
		"Gym 40.00000000 OUT - STANDARD",
		// Posted exactly, as income. The ASK template waits for a confirm.
		"Salary 2950.12345678 IN INCOME STANDARD",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got %q, want %q", got, want)
	}
}
