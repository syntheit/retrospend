package tasks

import (
	"strings"
	"testing"
)

func TestAFailedDumpRemovesNoOldFiles(t *testing.T) {
	// The last good backup of each kind must survive as long as the last good
	// main backup, so a failing run prunes nothing, for either kind.
	for name, run := range map[string]func(dir string) error{
		"keystore": func(dir string) error { return RunKeystoreBackup(nil, testDBURL, dir, 7, nil) },
		"main":     func(dir string) error { return RunBackup(nil, testDBURL, dir, 7, nil) },
	} {
		t.Run(name, func(t *testing.T) {
			fakePgDump(t, "exit 1")
			dir := t.TempDir()
			seedOld(t, dir, "keystore-20250101-000000.dump.age", 40*day)
			seedOld(t, dir, "retrospend-20250101-000000.dump.age", 40*day)

			if err := run(dir); err == nil {
				t.Fatal("expected the failed dump to be reported")
			}
			got := strings.Join(dirNames(t, dir), ",")
			want := "keystore-20250101-000000.dump.age,retrospend-20250101-000000.dump.age"
			if got != want {
				t.Fatalf("got %s, want %s", got, want)
			}
		})
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
			if err := RunBackups(nil, testDBURL, dir, 30, nil); err == nil {
				t.Fatal("expected the failure to be reported")
			}
			names := dirNames(t, dir)
			if len(names) != 1 || !strings.HasPrefix(names[0], tc.wantPrefix) {
				t.Fatalf("want one %s file, got %v", tc.wantPrefix, names)
			}
		})
	}
}
