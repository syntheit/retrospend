package tasks

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"retrospend-sidecar/db"
)

// TestKeystoreRestoreSteps runs the restore steps in docs/self-hosting.md
// ("Data key backups") against the dumps this package really writes: a fresh
// database restored main dump first, then the keystore dump and the orphan
// delete, then an in-place --clean restore of both. It needs a migrated test
// database (SIDECAR_TEST_DATABASE_URL, as the other *_db_test.go files do) and
// pg_dump, pg_restore on PATH, and it creates and drops one scratch database,
// so it lives here and not in the vitest pg suite: a DROP DATABASE holds a
// transaction open for seconds, and the event feed there reads behind the
// oldest open transaction of the whole server. For the same reason, do not run
// it against a server where a vitest pg run is in progress: its CREATE and DROP
// DATABASE hold back that cluster-wide outbox horizon.
func TestKeystoreRestoreSteps(t *testing.T) {
	rawURL := os.Getenv("SIDECAR_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("SIDECAR_TEST_DATABASE_URL not set")
	}
	if !strings.Contains(rawURL, "/retrospend_test") {
		t.Fatalf("SIDECAR_TEST_DATABASE_URL must name a retrospend_test database")
	}
	for _, bin := range []string{"pg_dump", "pg_restore"} {
		if _, err := exec.LookPath(bin); err != nil {
			// The URL is set, so this is a CI or deliberate run: a missing tool
			// must not let it pass silently.
			t.Fatalf("%s not on PATH, and SIDECAR_TEST_DATABASE_URL is set", bin)
		}
	}
	ctx := context.Background()
	source, err := db.Connect(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(source.Close)

	// Two users with one key each, in the source database.
	stamp := time.Now().Format("20060102150405.000000000")
	userA, userB := "restore-a-"+stamp, "restore-b-"+stamp
	mine := []string{userA, userB}
	for _, id := range mine {
		mustExec(t, source, `INSERT INTO "user" (id, name, username, email) VALUES ($1::text, $1::text, $1::text, $1::text || '@sidecar-test.invalid')`, id)
		mustExec(t, source, `INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId") VALUES ($1, 1, 'sealed-for-test', 1)`, id)
	}
	// The trigger takes the keys with the users.
	t.Cleanup(func() {
		if _, err := source.Pool.Exec(ctx, `DELETE FROM "user" WHERE id = ANY($1)`, mine); err != nil {
			t.Logf("could not delete the test users: %v", err)
		}
	})

	// The dumps come from the real backup code.
	dir := t.TempDir()
	if err := RunBackups(nil, rawURL, dir, 30, 7, nil); err != nil {
		t.Fatal(err)
	}
	mainDump, keysDump := findDump(t, dir, "retrospend-"), findDump(t, dir, "keystore-")
	if list := pgRestore(t, "--list", mainDump); strings.Contains(list, "user_data_key") {
		t.Fatal("main dump contains the keystore table")
	}
	list := pgRestore(t, "--list", keysDump)
	if !strings.Contains(list, "user_data_key") || strings.Contains(list, "TABLE public user ") {
		t.Fatalf("keystore dump is not only the keystore:\n%s", list)
	}

	// Scratch database, dropped at the end.
	parsed, _ := url.Parse(rawURL)
	scratchName := strings.TrimPrefix(parsed.Path, "/") + "_restore_" + fmt.Sprint(time.Now().UnixNano())
	mustExec(t, source, fmt.Sprintf(`CREATE DATABASE "%s"`, scratchName))
	parsed.Path = "/" + scratchName
	scratchURL := parsed.String()
	var scratch *db.DB
	t.Cleanup(func() {
		if scratch != nil {
			scratch.Close()
		}
		if _, err := source.Pool.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS "%s" WITH (FORCE)`, scratchName)); err != nil {
			t.Logf("could not drop scratch database %s: %v", scratchName, err)
		}
	})

	restore := func(clean bool, file string) {
		args := []string{"--no-owner"}
		if clean {
			args = append(args, "--clean", "--if-exists")
		}
		pgRestore(t, append(args, "--dbname="+scratchURL, file)...)
	}
	keyOwners := func() []string {
		rows, err := scratch.Pool.Query(ctx, `SELECT "userId" FROM keystore."user_data_key" WHERE "userId" = ANY($1) ORDER BY "userId"`, mine)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			out = append(out, id)
		}
		return out
	}
	count := func(sql string, args ...any) int {
		var n int
		if err := scratch.Pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}

	// Fresh database: the main dump first. No keystore yet, yet prod would list
	// the keystore migration as applied.
	restore(false, mainDump)
	scratch, err = db.Connect(scratchURL)
	if err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM pg_namespace WHERE nspname = 'keystore'`); n != 0 {
		t.Fatal("main dump brought the keystore schema")
	}
	if n := count(`SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '%\_keystore'`); n != 1 {
		t.Fatalf("keystore migration rows: %d", n)
	}
	// A user can still be deleted with no keystore.
	mustExec(t, scratch, `DELETE FROM "user" WHERE id = $1`, userB)

	// Then the keystore dump with no --schema, and the orphan delete.
	restore(false, keysDump)
	if got := keyOwners(); strings.Join(got, ",") != userA+","+userB {
		t.Fatalf("after keystore restore: %v", got)
	}
	mustExec(t, scratch, `DELETE FROM keystore.user_data_key k WHERE NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = k."userId")`)
	if got := keyOwners(); strings.Join(got, ",") != userA {
		t.Fatalf("after the orphan delete, want only %s, got %v", userA, got)
	}
	if n := count(`SELECT count(*) FROM pg_class WHERE oid = 'keystore.user_data_key'::regclass AND relrowsecurity`); n != 1 {
		t.Fatal("row-level security did not come back")
	}

	// The restored database keeps the cascade.
	mustExec(t, scratch, `DELETE FROM "user" WHERE id = $1`, userA)
	if got := keyOwners(); len(got) != 0 {
		t.Fatalf("trigger did not remove the key: %v", got)
	}

	// In place over a populated database, both restores succeed and bring
	// everything in the dumps back.
	scratch.Close()
	scratch = nil
	restore(true, mainDump)
	restore(true, keysDump)
	scratch, err = db.Connect(scratchURL)
	if err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM "user" WHERE id = ANY($1)`, mine); n != 2 {
		t.Fatalf("users after in-place restore: %d", n)
	}
	if got := keyOwners(); strings.Join(got, ",") != userA+","+userB {
		t.Fatalf("keys after in-place restore: %v", got)
	}
}

func mustExec(t *testing.T, d *db.DB, sql string, args ...any) {
	t.Helper()
	if _, err := d.Pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func findDump(t *testing.T, dir, prefix string) string {
	t.Helper()
	matches, _ := filepath.Glob(filepath.Join(dir, prefix+"*.dump"))
	if len(matches) != 1 {
		t.Fatalf("want one %s dump, got %v", prefix, matches)
	}
	return matches[0]
}

// pgRestore runs pg_restore and returns stdout. A pg_dump newer than the test
// server writes `SET transaction_timeout`, which an older server rejects;
// pg_restore reports it and goes on. That one error is the only one allowed.
func pgRestore(t *testing.T, args ...string) string {
	t.Helper()
	var stdout, stderr strings.Builder
	cmd := exec.Command("pg_restore", args...)
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		for _, line := range strings.Split(stderr.String(), "\n") {
			if strings.Contains(line, "error:") && !strings.Contains(line, "transaction_timeout") {
				t.Fatalf("pg_restore %v: %v\n%s", args, err, stderr.String())
			}
		}
	}
	return stdout.String()
}
