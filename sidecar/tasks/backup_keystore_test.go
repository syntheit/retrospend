package tasks

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// recordArgs makes the fake pg_dump append its arguments, one run per line, to
// the returned file.
func recordArgs(t *testing.T) string {
	t.Helper()
	argsFile := filepath.Join(t.TempDir(), "args.txt")
	fakePgDump(t, "echo \"$@\" >> "+argsFile)
	return argsFile
}

func readRuns(t *testing.T, argsFile string) []string {
	t.Helper()
	raw, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(raw)), "\n")
}

func TestMainDumpExcludesKeystoreAndKeystoreDumpIsOnlyKeystore(t *testing.T) {
	argsFile := recordArgs(t)
	_, pub := newIdentity(t)
	dir := t.TempDir()

	if err := RunBackups(nil, testDBURL, dir, 30, 7, []string{pub}); err != nil {
		t.Fatal(err)
	}
	runs := readRuns(t, argsFile)
	if len(runs) != 2 {
		t.Fatalf("want two pg_dump runs, got %v", runs)
	}
	if !strings.Contains(runs[0], "--exclude-schema=keystore") || strings.Contains(runs[0], " --schema=") {
		t.Fatalf("main dump must exclude the keystore schema: %q", runs[0])
	}
	if !strings.Contains(runs[1], "--schema=keystore") || strings.Contains(runs[1], "--exclude-schema") {
		t.Fatalf("keystore dump must name only the keystore schema: %q", runs[1])
	}

	var main, keys int
	for _, name := range dirNames(t, dir) {
		switch {
		case strings.HasPrefix(name, "retrospend-") && strings.HasSuffix(name, ".dump.age"):
			main++
		case strings.HasPrefix(name, "keystore-") && strings.HasSuffix(name, ".dump.age"):
			keys++
		default:
			t.Fatalf("unexpected file %q", name)
		}
	}
	if main != 1 || keys != 1 {
		t.Fatalf("want one main and one keystore file, got %d and %d", main, keys)
	}
}

func TestKeystoreDumpIsEncryptedLikeTheMainOne(t *testing.T) {
	fakePgDump(t, "exit 0")
	id, pub := newIdentity(t)
	dir := t.TempDir()
	ts := fixedClock(t)

	if err := RunKeystoreBackup(nil, testDBURL, dir, 7, []string{pub}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "keystore-"+ts+".dump.age")
	raw, err := os.ReadFile(path)
	if err != nil || strings.Contains(string(raw), plainMarker) {
		t.Fatalf("missing or plaintext: %v", err)
	}
	if dec, err := decryptFile(t, path, id); err != nil || len(dec) != fakeDumpLen {
		t.Fatalf("decrypt: %v, %d bytes", err, len(dec))
	}
}

func seedOld(t *testing.T, dir, name string, age time.Duration) {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	mtime := time.Now().Add(-age)
	os.Chtimes(p, mtime, mtime)
}

const day = 24 * time.Hour

func TestEachDumpKeepsItsOwnRetention(t *testing.T) {
	fakePgDump(t, "exit 0")
	dir := t.TempDir()
	seedOld(t, dir, "retrospend-20250101-000000.dump", 10*day)
	seedOld(t, dir, "retrospend-20250102-000000.dump", 40*day)
	seedOld(t, dir, "keystore-20250101-000000.dump", 10*day)
	seedOld(t, dir, "keystore-20250102-000000.dump.age", 2*day)

	// Main keeps 30 days, keystore keeps 7: only the 10 day old keystore file
	// and the 40 day old main file go.
	if err := RunBackups(nil, testDBURL, dir, 30, 7, nil); err != nil {
		t.Fatal(err)
	}
	have := map[string]bool{}
	for _, name := range dirNames(t, dir) {
		have[name] = true
	}
	for name, want := range map[string]bool{
		"retrospend-20250101-000000.dump":   true,
		"retrospend-20250102-000000.dump":   false,
		"keystore-20250101-000000.dump":     false,
		"keystore-20250102-000000.dump.age": true,
	} {
		if have[name] != want {
			t.Errorf("%s: kept=%v, want %v (files: %v)", name, have[name], want, have)
		}
	}
}

func TestMainRetentionNeverRemovesKeystoreFiles(t *testing.T) {
	fakePgDump(t, "exit 0")
	dir := t.TempDir()
	seedOld(t, dir, "retrospend-20250101-000000.dump", 10*day)
	seedOld(t, dir, "keystore-20250101-000000.dump", 10*day)

	// A short main retention and a long keystore one: the keystore file stays.
	if err := RunBackups(nil, testDBURL, dir, 1, 30, nil); err != nil {
		t.Fatal(err)
	}
	names := strings.Join(dirNames(t, dir), ",")
	if strings.Contains(names, "retrospend-20250101") || !strings.Contains(names, "keystore-20250101-000000.dump") {
		t.Fatalf("got %s", names)
	}
}

func TestStatusKeepsKeystoreRunsOutOfTheMainHistory(t *testing.T) {
	fakePgDump(t, "exit 0")
	dir := t.TempDir()
	if err := RunBackups(nil, testDBURL, dir, 30, 7, nil); err != nil {
		t.Fatal(err)
	}
	status := GetBackupStatus(dir, 30, 7, nil)
	if status.TotalBackups != 1 || status.LastBackup == nil || status.LastBackup.Kind != "" {
		t.Fatalf("main status polluted: %+v", status)
	}
	if status.LastKeystoreBackup == nil || status.LastKeystoreBackup.Kind != "keystore" || status.KeystoreRetentionDays != 7 {
		t.Fatalf("keystore status missing: %+v", status)
	}
}

func TestStalePartialSweepCoversKeystorePartials(t *testing.T) {
	dir := t.TempDir()
	stale := 7 * time.Hour
	seedOld(t, dir, ".keystore-old.dump.age.partial", stale)
	seedOld(t, dir, ".keystore-new.dump.age.partial", time.Minute)
	removeStalePartials(dir)
	if got := strings.Join(dirNames(t, dir), ","); got != ".keystore-new.dump.age.partial" {
		t.Fatalf("got %s", got)
	}
}
