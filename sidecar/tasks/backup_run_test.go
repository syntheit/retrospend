package tasks

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	testDBURL   = "postgresql://u:p@h:5432/d"
	fakeDumpLen = 3_000_000 // well past the pipe buffer, so an undrained pg_dump blocks
	plainMarker = "PGDMP-PLAINTEXT"
)

// fakePgDump replaces pg_dump with a script that writes fakeDumpLen bytes to the
// --file target, or to stdout when there is none, then runs tail.
func fakePgDump(t *testing.T, tail string) {
	t.Helper()
	script := "#!/bin/sh\n" +
		"out=\n" +
		"for a in \"$@\"; do case \"$a\" in --file=*) out=\"${a#--file=}\";; esac; done\n" +
		"if [ -n \"$out\" ]; then yes " + plainMarker + " | head -c 3000000 > \"$out\"; else yes " + plainMarker + " | head -c 3000000; fi\n" +
		tail + "\n"
	bin := filepath.Join(t.TempDir(), "pg_dump")
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	old := pgDumpBin
	pgDumpBin = bin
	t.Cleanup(func() { pgDumpBin = old })
}

func fixedClock(t *testing.T) string {
	t.Helper()
	old := backupNow
	backupNow = func() time.Time { return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC) }
	t.Cleanup(func() { backupNow = old })
	return "20260102-030405"
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		if e.Name() != "backup_manifest.json" {
			names = append(names, e.Name())
		}
	}
	return names
}

func TestRunBackupWithKeyWritesOnlyADecryptableAgeFile(t *testing.T) {
	fakePgDump(t, "exit 0")
	id, pub := newIdentity(t)
	dir := t.TempDir()

	if err := RunBackup(nil, testDBURL, dir, 30, []string{pub}); err != nil {
		t.Fatal(err)
	}
	names := dirNames(t, dir)
	if len(names) != 1 || !strings.HasSuffix(names[0], ".dump.age") {
		t.Fatalf("want one .dump.age file, got %v", names)
	}
	path := filepath.Join(dir, names[0])
	raw, _ := os.ReadFile(path)
	if bytes.Contains(raw, []byte(plainMarker)) {
		t.Fatal("backup file contains plaintext")
	}
	dec, err := decryptFile(t, path, id)
	if err != nil || len(dec) != fakeDumpLen || !bytes.HasPrefix(dec, []byte(plainMarker)) {
		t.Fatalf("decrypt: %v, %d bytes", err, len(dec))
	}
	if IsBackupRunning() {
		t.Fatal("still marked running")
	}
}

func TestRunBackupWithoutKeyIsUnchanged(t *testing.T) {
	fakePgDump(t, "exit 0")
	dir := t.TempDir()
	if err := RunBackup(nil, testDBURL, dir, 30, nil); err != nil {
		t.Fatal(err)
	}
	names := dirNames(t, dir)
	if len(names) != 1 || !strings.HasSuffix(names[0], ".dump") {
		t.Fatalf("want one .dump file, got %v", names)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, names[0]))
	if len(raw) != fakeDumpLen || !bytes.HasPrefix(raw, []byte(plainMarker)) {
		t.Fatalf("plain dump not written as is: %d bytes", len(raw))
	}
}

func TestRunBackupFailedPlainDumpLeavesNoPartial(t *testing.T) {
	fakePgDump(t, "exit 1")
	dir := t.TempDir()
	if err := RunBackup(nil, testDBURL, dir, 30, nil); err == nil {
		t.Fatal("expected an error")
	}
	if names := dirNames(t, dir); len(names) != 0 {
		t.Fatalf("files left behind: %v", names)
	}
}

func TestRunBackupNeverDeletesAnExistingBackup(t *testing.T) {
	fakePgDump(t, "exit 0")
	ts := fixedClock(t)
	_, pub := newIdentity(t)
	dir := t.TempDir()
	existing := filepath.Join(dir, "retrospend-"+ts+".dump.age")
	if err := os.WriteFile(existing, []byte("older backup"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := RunBackup(nil, testDBURL, dir, 30, []string{pub}); err == nil {
		t.Fatal("expected a refusal")
	}
	got, err := os.ReadFile(existing)
	if err != nil || string(got) != "older backup" {
		t.Fatalf("existing backup was touched: %v %q", err, got)
	}
	if names := dirNames(t, dir); len(names) != 1 {
		t.Fatalf("unexpected files: %v", names)
	}
}

func TestRunBackupEncryptionFailingMidDumpDoesNotHang(t *testing.T) {
	fakePgDump(t, "exit 0")
	_, pub := newIdentity(t)
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0o700) })
	if f, err := os.Create(filepath.Join(dir, "probe")); err == nil {
		f.Close()
		t.Skip("directory is writable despite chmod (running as root?)")
	}

	done := make(chan error, 1)
	go func() { done <- RunBackup(nil, testDBURL, dir, 30, []string{pub}) }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected an error")
		}
	case <-time.After(20 * time.Second):
		t.Fatal("RunBackup hung: pg_dump is blocked on a pipe nobody reads")
	}
	if IsBackupRunning() {
		t.Fatal("still marked running after failure")
	}
	if names := dirNames(t, dir); len(names) != 0 {
		t.Fatalf("files left behind: %v", names)
	}
}

func TestRetentionRemovesStalePartialsAndKeepsFreshOnes(t *testing.T) {
	dir := t.TempDir()
	stale := time.Now().Add(-stalePartialAge - time.Hour)
	// A stale partial can be a full plaintext dump, so it must not outlive the
	// retention period even though it is not a listed backup.
	for name, mtime := range map[string]time.Time{
		".retrospend-old.dump.partial":     stale,
		".retrospend-old.dump.age.partial": stale,
		".retrospend-new.dump.age.partial": time.Now(),
		"retrospend-old.dump.age":          stale.AddDate(0, 0, -90),
		"notes.partial":                    stale,
	} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		os.Chtimes(p, mtime, mtime)
	}
	cleanupOldBackups(dir, 30)
	names := dirNames(t, dir)
	if len(names) != 2 || names[0] != ".retrospend-new.dump.age.partial" || names[1] != "notes.partial" {
		t.Fatalf("retention removed or kept the wrong files: %v", names)
	}
}

func TestPublishPartialNeverReplacesAnExistingBackup(t *testing.T) {
	dir := t.TempDir()
	final := filepath.Join(dir, "retrospend-x.dump")
	partial := partialPath(final)
	os.WriteFile(final, []byte("existing"), 0o600)
	os.WriteFile(partial, []byte("new"), 0o600)
	if err := publishPartial(partial, final); err == nil {
		t.Fatal("expected a refusal")
	}
	if got, _ := os.ReadFile(final); string(got) != "existing" {
		t.Fatalf("existing backup replaced: %q", got)
	}

	os.Remove(final)
	if err := publishPartial(partial, final); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(final); string(got) != "new" {
		t.Fatalf("not published: %q", got)
	}
	if _, err := os.Stat(partial); err == nil {
		t.Fatal("partial name left behind")
	}
}
