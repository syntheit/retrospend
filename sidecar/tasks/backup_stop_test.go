package tasks

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// StopBackups is what the sidecar calls when the owner role appears while it
// runs as the superuser: the running pg_dump must end (its locks stall the
// app's ownership handover), leave no partial file, and nothing may start
// after it, not even the keystore dump that follows the main one.
func TestStopBackupsAbortsTheRunningDumpAndStartsNoMore(t *testing.T) {
	for name, recipients := range map[string]func(t *testing.T) []string{
		"plain":     func(*testing.T) []string { return nil },
		"encrypted": func(t *testing.T) []string { _, pub := newIdentity(t); return []string{pub} },
	} {
		t.Run(name, func(t *testing.T) {
			t.Cleanup(func() {
				backupMu.Lock()
				backupStopped = false
				backupMu.Unlock()
			})
			started := filepath.Join(t.TempDir(), "started.txt")
			fakePgDump(t, "echo run >> "+started+"\nexec sleep 30")
			dir := t.TempDir()

			done := make(chan error, 1)
			go func() { done <- RunBackups(nil, testDBURL, dir, 30, recipients(t)) }()

			// Wait until the fake pg_dump has written something and is sleeping.
			deadline := time.Now().Add(10 * time.Second)
			for {
				if raw, _ := os.ReadFile(started); strings.Contains(string(raw), "run") {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("the dump never started")
				}
				time.Sleep(20 * time.Millisecond)
			}
			if !IsBackupRunning() {
				t.Fatal("a dump is running but IsBackupRunning is false")
			}

			begin := time.Now()
			if aborted := StopBackups(); !aborted {
				t.Fatal("StopBackups did not see the running dump")
			}
			select {
			case err := <-done:
				if err == nil || !strings.Contains(err.Error(), "aborted") {
					t.Fatalf("RunBackups returned %v, want an abort", err)
				}
			case <-time.After(15 * time.Second):
				t.Fatal("RunBackups still running 15 s after StopBackups")
			}
			if took := time.Since(begin); took > 10*time.Second {
				t.Fatalf("the dump took %s to stop", took)
			}

			// Only the main dump ever started: the keystore dump was refused.
			if raw, _ := os.ReadFile(started); strings.Count(string(raw), "run") != 1 {
				t.Fatalf("pg_dump ran %d times, want 1", strings.Count(string(raw), "run"))
			}
			// No partial file and no backup, and the manifest records the abort.
			for _, entry := range dirNames(t, dir) {
				if strings.HasSuffix(entry, ".partial") || strings.Contains(entry, ".dump") {
					t.Fatalf("left %s behind in %v", entry, dirNames(t, dir))
				}
			}
			results := readManifest(dir)
			if len(results) == 0 || results[0].Success || !strings.Contains(results[0].Error, "aborted") {
				t.Fatalf("manifest: %+v", results)
			}
			if IsBackupRunning() {
				t.Fatal("still marked running")
			}
			// Later runs return at once.
			if err := RunBackup(nil, testDBURL, dir, 30, recipients(t)); !errors.Is(err, errBackupsStopped) {
				t.Fatalf("a run after StopBackups returned %v", err)
			}
		})
	}
}

func TestStopBackupsWithNothingRunningStillBlocksLaterRuns(t *testing.T) {
	t.Cleanup(func() {
		backupMu.Lock()
		backupStopped = false
		backupMu.Unlock()
	})
	started := filepath.Join(t.TempDir(), "started.txt")
	fakePgDump(t, "echo run >> "+started)
	if StopBackups() {
		t.Fatal("nothing was running")
	}
	if err := RunBackups(nil, testDBURL, t.TempDir(), 30, nil); !errors.Is(err, errBackupsStopped) {
		t.Fatalf("got %v", err)
	}
	if _, err := os.Stat(started); err == nil {
		t.Fatal("pg_dump ran after StopBackups")
	}
}
