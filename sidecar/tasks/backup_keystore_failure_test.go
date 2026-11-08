package tasks

import (
	"strings"
	"testing"
)

func TestFailingKeystoreDumpStillPrunesOldKeyFiles(t *testing.T) {
	fakePgDump(t, "exit 1")
	dir := t.TempDir()
	seedOld(t, dir, "keystore-20250101-000000.dump.age", 10*day)
	seedOld(t, dir, "keystore-20250102-000000.dump.age", 2*day)
	seedOld(t, dir, "retrospend-20250101-000000.dump.age", 40*day)

	if err := RunKeystoreBackup(nil, testDBURL, dir, 7, nil); err == nil {
		t.Fatal("expected the failed dump to be reported")
	}
	got := strings.Join(dirNames(t, dir), ",")
	// The keystore file past its window is gone; the recent one and the main
	// backup (not this run's business) stay.
	want := "keystore-20250102-000000.dump.age,retrospend-20250101-000000.dump.age"
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestFailingMainDumpKeepsItsFiles(t *testing.T) {
	// The main dump's old files may be the only good backups left.
	fakePgDump(t, "exit 1")
	dir := t.TempDir()
	seedOld(t, dir, "retrospend-20250101-000000.dump.age", 40*day)
	if err := RunBackup(nil, testDBURL, dir, 30, nil); err == nil {
		t.Fatal("expected an error")
	}
	if got := strings.Join(dirNames(t, dir), ","); got != "retrospend-20250101-000000.dump.age" {
		t.Fatalf("got %s", got)
	}
}

func TestOneFailingDumpDoesNotSkipTheOther(t *testing.T) {
	cases := map[string]struct{ failPattern, wantPrefix string }{
		"main fails":     {"*--exclude-schema*", "keystore-"},
		"keystore fails": {"*--schema=keystore*", "retrospend-"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			fakePgDump(t, `case "$*" in `+tc.failPattern+`) exit 1;; esac`)
			dir := t.TempDir()
			if err := RunBackups(nil, testDBURL, dir, 30, 7, nil); err == nil {
				t.Fatal("expected the failure to be reported")
			}
			names := dirNames(t, dir)
			if len(names) != 1 || !strings.HasPrefix(names[0], tc.wantPrefix) {
				t.Fatalf("want one %s file, got %v", tc.wantPrefix, names)
			}
		})
	}
}
