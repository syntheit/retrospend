package tasks

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"retrospend-sidecar/config"
	"retrospend-sidecar/db"
)

// TestBackupAsOwnerCoversForceRLSTablesAndKeystore is the sidecar side of the
// owner role (scripts/db-owner, prisma/bootstrap). On a scratch copy of the
// test database in the legacy state (every object owned by the superuser) it
// runs the same bootstrap SQL the app runs, then checks, over a real server:
//
//   - the sidecar does not take the owner's URL until the handover is done;
//   - once it is, the URL it gets is the owner's, the pool signs in as a role
//     that is not a superuser, and the real `sidecar owner-url` command prints
//     that URL and nothing else on stdout;
//   - pg_dump as the owner covers the FORCE ROW LEVEL SECURITY tables and the
//     keystore schema: both dumps restore into a fresh database with every
//     row that the superuser's copy has.
//
// It needs SIDECAR_TEST_DATABASE_URL (a superuser URL to a migrated database),
// pg_dump and pg_restore, and the go tool. Like TestKeystoreRestoreSteps it
// creates and drops scratch databases, so do not run it while a vitest pg run
// uses the same server. It creates the retrospend_owner role when the cluster
// has none and never changes the password of one that signs in.
func TestBackupAsOwnerCoversForceRLSTablesAndKeystore(t *testing.T) {
	rawURL := os.Getenv("SIDECAR_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("SIDECAR_TEST_DATABASE_URL not set")
	}
	if !strings.Contains(rawURL, "/retrospend_test") {
		t.Fatalf("SIDECAR_TEST_DATABASE_URL must name a retrospend_test database")
	}
	for _, bin := range []string{"pg_dump", "pg_restore", "go"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Fatalf("%s not on PATH, and SIDECAR_TEST_DATABASE_URL is set", bin)
		}
	}
	superPassword, ok := config.URLPassword(rawURL)
	if !ok {
		t.Fatal("SIDECAR_TEST_DATABASE_URL needs a password: the owner's is derived from it")
	}
	ctx := context.Background()
	source, err := db.Connect(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(source.Close)

	// Two users with a key each, and snoozes (a FORCE ROW LEVEL SECURITY table)
	// for the first, in the source database.
	stamp := time.Now().Format("20060102150405.000000000")
	userA, userB := "owner-a-"+stamp, "owner-b-"+stamp
	mine := []string{userA, userB}
	for _, id := range mine {
		mustExec(t, source, `INSERT INTO "user" (id, name, username, email) VALUES ($1::text, $1::text, $1::text, $1::text || '@sidecar-test.invalid')`, id)
		mustExec(t, source, `INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId") VALUES ($1, 1, 'sealed-for-test', 1)`, id)
	}
	mustExec(t, source, `INSERT INTO needs_you_snooze (id, "userId", "itemId", "until") VALUES ($1 || '-1', $2, 'item-1', now() + interval '1 day'), ($1 || '-2', $2, 'item-2', now() + interval '2 days')`, stamp, userA)
	t.Cleanup(func() {
		if _, err := source.Pool.Exec(ctx, `DELETE FROM "user" WHERE id = ANY($1)`, mine); err != nil {
			t.Logf("could not delete the test users: %v", err)
		}
	})

	// The legacy state: a copy where the superuser owns everything.
	legacyDir := t.TempDir()
	if err := RunBackups(nil, rawURL, legacyDir, 30, nil); err != nil {
		t.Fatal(err)
	}
	legacyMain, legacyKeys := findDump(t, legacyDir, "retrospend-"), findDump(t, legacyDir, "keystore-")

	parsed, _ := url.Parse(rawURL)
	base := strings.TrimPrefix(parsed.Path, "/")
	suffix := fmt.Sprint(time.Now().UnixNano())
	urlFor := func(name string) string {
		u := *parsed
		u.Path = "/" + name
		return u.String()
	}
	newDatabase := func(label string) (name, dbURL string) {
		name = base + "_" + label + "_" + suffix
		mustExec(t, source, fmt.Sprintf(`CREATE DATABASE "%s"`, name))
		t.Cleanup(func() {
			if _, err := source.Pool.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS "%s" WITH (FORCE)`, name)); err != nil {
				t.Logf("could not drop scratch database %s: %v", name, err)
			}
		})
		return name, urlFor(name)
	}
	restoreInto := func(dbURL string, files ...string) {
		for _, f := range files {
			pgRestore(t, "--no-owner", "--dbname="+dbURL, f)
		}
	}

	_, scratchURL := newDatabase("owner")
	restoreInto(scratchURL, legacyMain, legacyKeys)
	scratch, err := db.Connect(scratchURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(scratch.Close)
	if n := countRows(t, scratch, `SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.relname = 'needs_you_snooze' AND r.rolsuper`); n != 1 {
		t.Fatal("the scratch copy is not in the legacy state (superuser-owned)")
	}

	// The same bootstrap the app's entrypoint runs, as the superuser: the role,
	// then (separately) the handover.
	ownerPassword := config.DeriveOwnerPassword(superPassword)
	ownerURL, err := config.OwnerURL(scratchURL, ownerPassword)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, scratch, readRepoFile(t, "prisma", "bootstrap", "owner-role.sql"))
	if !canSignIn(ownerURL) {
		// A new role, or a stale password. Plain ALTER ROLE is fine in a test.
		mustExec(t, scratch, fmt.Sprintf(`ALTER ROLE %s PASSWORD '%s'`, config.OwnerRole, ownerPassword))
	}

	// Before the handover the sidecar must not take the owner's URL, and must
	// not fall back to the superuser either.
	notReady := config.DefaultOwnerOptions()
	notReady.ReadyWait, notReady.Poll = 0, 0
	got, err := config.ResolveOwnerURL(ctx, scratchURL, notReady)
	if !errors.Is(err, config.ErrOwnerNotReady) || got != "" {
		t.Fatalf("before the handover: got %q, %v; want ErrOwnerNotReady", got, err)
	}
	if !strings.Contains(err.Error(), "not handed to the owner") {
		t.Fatalf("unclear reason: %v", err)
	}

	rows, err := scratch.Pool.Query(ctx, readRepoFile(t, "prisma", "bootstrap", "owner-handover.sql"))
	if err != nil {
		t.Fatal(err)
	}
	var statements []string
	for rows.Next() {
		var ddl string
		if err := rows.Scan(&ddl); err != nil {
			t.Fatal(err)
		}
		statements = append(statements, ddl)
	}
	rows.Close()
	if len(statements) == 0 {
		t.Fatal("the handover found nothing to do on a superuser-owned copy")
	}
	for _, ddl := range statements {
		mustExec(t, scratch, ddl)
	}

	// Now the sidecar's own decision.
	ready := config.DefaultOwnerOptions()
	ready.ReadyWait, ready.Poll = 5*time.Second, 100*time.Millisecond
	got, err = config.ResolveOwnerURL(ctx, scratchURL, ready)
	if err != nil {
		t.Fatalf("after the handover: %v", err)
	}
	if got != ownerURL {
		t.Fatalf("resolved to the wrong URL (user %q)", mustParseUser(t, got))
	}

	// The real command prints that URL, and only that, on stdout.
	assertOwnerURLCommand(t, scratchURL, ownerURL)

	// The pool runs as the owner: not a superuser, and it sees FORCE tables.
	owner, err := db.Connect(got)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	var sessionUser, currentUser string
	var super, bypass bool
	if err := owner.Pool.QueryRow(ctx, `SELECT session_user, current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`).Scan(&sessionUser, &currentUser, &super, &bypass); err != nil {
		t.Fatal(err)
	}
	if sessionUser != config.OwnerRole || currentUser != config.OwnerRole || super || !bypass {
		t.Fatalf("pool is %s/%s super=%v bypassrls=%v", sessionUser, currentUser, super, bypass)
	}
	// The fallback watchdog's two questions, against a real server: the
	// superuser's pool is told apart from the owner's, and the role is seen.
	if super, err := config.RunningAsSuperuser(ctx, source.Pool); err != nil || !super {
		t.Fatalf("RunningAsSuperuser(superuser pool) = %v, %v", super, err)
	}
	if super, err := config.RunningAsSuperuser(ctx, owner.Pool); err != nil || super {
		t.Fatalf("RunningAsSuperuser(owner pool) = %v, %v", super, err)
	}
	if exists, err := config.OwnerRoleExists(ctx, source.Pool); err != nil || !exists {
		t.Fatalf("OwnerRoleExists = %v, %v", exists, err)
	}
	if n := countRows(t, owner, `SELECT count(*) FROM needs_you_snooze WHERE "userId" = $1`, userA); n != 2 {
		t.Fatalf("the owner sees %d snoozes of user A, want 2 (FORCE ROW LEVEL SECURITY with BYPASSRLS)", n)
	}
	if n := countRows(t, owner, `SELECT count(*) FROM pg_class WHERE relname = 'needs_you_snooze' AND relforcerowsecurity`); n != 1 {
		t.Fatal("needs_you_snooze is no longer FORCE ROW LEVEL SECURITY: this test would prove nothing")
	}

	// The real backup code, as the owner: both dumps.
	ownerDir := t.TempDir()
	if err := RunBackups(owner, got, ownerDir, 30, nil); err != nil {
		t.Fatalf("backup as the owner: %v", err)
	}
	ownerMain, ownerKeys := findDump(t, ownerDir, "retrospend-"), findDump(t, ownerDir, "keystore-")
	if list := pgRestore(t, "--list", ownerMain); strings.Contains(list, "user_data_key") {
		t.Fatal("the owner's main dump holds the keystore table")
	}
	if list := pgRestore(t, "--list", ownerKeys); !strings.Contains(list, "user_data_key") {
		t.Fatalf("the owner's keystore dump has no keystore table:\n%s", list)
	}

	// Restore both into a fresh database and compare with the source.
	_, restoredURL := newDatabase("restored")
	restoreInto(restoredURL, ownerMain, ownerKeys)
	restored, err := db.Connect(restoredURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restored.Close)

	if n := countRows(t, restored, `SELECT count(*) FROM needs_you_snooze WHERE "userId" = $1`, userA); n != 2 {
		t.Fatalf("restored snoozes: %d, want 2", n)
	}
	if n := countRows(t, restored, `SELECT count(*) FROM keystore.user_data_key WHERE "userId" = ANY($1)`, mine); n != 2 {
		t.Fatalf("restored keys: %d, want 2", n)
	}
	// Every FORCE ROW LEVEL SECURITY table has as many rows as in the source.
	forced, err := scratch.Pool.Query(ctx, `SELECT format('%I.%I', n.nspname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND c.relforcerowsecurity ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for forced.Next() {
		var name string
		if err := forced.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	forced.Close()
	if len(tables) < 4 {
		t.Fatalf("expected at least the four FORCE tables, found %v", tables)
	}
	for _, table := range tables {
		query := "SELECT count(*) FROM " + table
		if want, got := countRows(t, source, query), countRows(t, restored, query); want != got {
			t.Errorf("%s: %d rows in the source, %d after the owner's dump and restore", table, want, got)
		}
	}
}

// assertOwnerURLCommand builds the sidecar and runs `owner-url` the way the
// entrypoint does, with the superuser URL in DATABASE_URL.
func assertOwnerURLCommand(t *testing.T, superURL, wantURL string) {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "sidecar")
	build := exec.Command("go", "build", "-o", bin, "..")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	cmd := exec.Command(bin, "owner-url")
	cmd.Env = append(os.Environ(), "DATABASE_URL="+superURL, "DATABASE_OWNER_PASSWORD=")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("owner-url: %v\n%s", err, stderr.String())
	}
	if strings.TrimSpace(stdout.String()) != wantURL || strings.Count(stdout.String(), "\n") != 1 {
		t.Fatalf("owner-url printed %q", stdout.String())
	}
	superPassword, _ := config.URLPassword(superURL)
	if strings.Contains(stderr.String(), superPassword) || strings.Contains(stderr.String(), "postgresql://") {
		t.Fatalf("owner-url logged a credential:\n%s", stderr.String())
	}
}

func canSignIn(dbURL string) bool {
	d, err := db.Connect(dbURL)
	if err != nil {
		return false
	}
	d.Close()
	return true
}

func countRows(t *testing.T, d *db.DB, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := d.Pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func readRepoFile(t *testing.T, parts ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(append([]string{"..", ".."}, parts...)...))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func mustParseUser(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u.User.Username()
}
