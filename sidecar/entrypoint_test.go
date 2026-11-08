package main

import (
	"bytes"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

const (
	wrapperSuperPassword = "S3cr3t:pa$$/w'rd"
	wrapperOwnerURL      = "postgresql://retrospend_owner:0123456789abcdef@postgres:5432/retrospend"
)

var wrapperSuperURL = "postgresql://postgres:" + url.QueryEscape(wrapperSuperPassword) + "@postgres:5432/retrospend"

// stubSidecar stands in for the real binary: `owner-url` prints what the test
// says (or fails), and any other call writes its environment to the file named
// by its first argument.
const stubSidecar = `#!/bin/sh
if [ "$1" = owner-url ]; then
  # The real command runs with the full environment, superuser URL included.
  [ -n "$DATABASE_URL" ] || exit 4
  [ -z "$STUB_FAIL" ] || exit 3
  printf '%s\n' "$STUB_OWNER_URL"
  exit 0
fi
env > "$1"
`

// testShell is /bin/sh, or ENTRYPOINT_TEST_SHELL to try another (the image's
// is busybox ash; dash and bash behave the same on this script).
func testShell() string {
	if sh := os.Getenv("ENTRYPOINT_TEST_SHELL"); sh != "" {
		return sh
	}
	return "/bin/sh"
}

// runWrapper runs the real entrypoint.sh against the stub, with an environment
// like the one compose gives the container, and returns the environment the
// final process got (nil when it never started), stderr and the exit error.
func runWrapper(t *testing.T, extra ...string) (finalEnv map[string]string, stderr string, runErr error) {
	t.Helper()
	dir := t.TempDir()
	script, err := os.ReadFile("entrypoint.sh")
	if err != nil {
		t.Fatal(err)
	}
	wrapper := filepath.Join(dir, "entrypoint.sh")
	if err := os.WriteFile(wrapper, script, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sidecar"), []byte(stubSidecar), 0o755); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "final-env")

	env := []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=/home/appuser",
		"HOSTNAME=sidecar",
		"DATABASE_URL=" + wrapperSuperURL,
		"POSTGRES_USER=postgres",
		"POSTGRES_PASSWORD=" + wrapperSuperPassword,
		"POSTGRES_DB_NAME=retrospend",
		"DATABASE_OWNER_PASSWORD=my-own-secret",
		"SUPERUSER_URL_COPY=" + wrapperSuperURL,
		"WORKER_API_KEY=key'with\"quotes and $HOME `id` $(id)",
		"BACKUP_CRON=0 3 * * *",
		"BACKUP_AGE_RECIPIENT=age1abc",
		"OPENROUTER_API_KEY=",
		"STUB_OWNER_URL=" + wrapperOwnerURL,
	}
	env = append(env, extra...)

	cmd := exec.Command(testShell(), wrapper, filepath.Join(dir, "sidecar"), out)
	cmd.Env = env
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	runErr = cmd.Run()

	raw, readErr := os.ReadFile(out)
	if readErr != nil {
		return nil, errBuf.String(), runErr
	}
	finalEnv = map[string]string{}
	for _, line := range strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n") {
		name, value, _ := strings.Cut(line, "=")
		finalEnv[name] = value
	}
	return finalEnv, errBuf.String(), runErr
}

func TestEntrypointExecsWithOnlyTheOwnerURL(t *testing.T) {
	got, stderr, err := runWrapper(t)
	if err != nil {
		t.Fatalf("wrapper failed: %v\n%s", err, stderr)
	}
	if got["DATABASE_URL"] != wrapperOwnerURL {
		t.Fatalf("DATABASE_URL = %q, want the owner URL", got["DATABASE_URL"])
	}
	encodings := []string{wrapperSuperPassword, url.QueryEscape(wrapperSuperPassword), url.PathEscape(wrapperSuperPassword)}
	for name, value := range got {
		for _, secret := range encodings {
			if strings.Contains(value, secret) {
				t.Errorf("%s holds the superuser's password (%q)", name, secret)
			}
		}
	}
	for _, name := range []string{"POSTGRES_PASSWORD", "POSTGRES_USER", "POSTGRES_DB_NAME", "DATABASE_OWNER_PASSWORD", "SUPERUSER_URL_COPY", "STUB_OWNER_URL"} {
		if _, ok := got[name]; ok {
			t.Errorf("%s reached the sidecar", name)
		}
	}
	// What the sidecar reads arrives intact, odd characters and all.
	if got["WORKER_API_KEY"] != "key'with\"quotes and $HOME `id` $(id)" {
		t.Errorf("WORKER_API_KEY = %q", got["WORKER_API_KEY"])
	}
	if got["BACKUP_CRON"] != "0 3 * * *" || got["BACKUP_AGE_RECIPIENT"] != "age1abc" || got["HOME"] != "/home/appuser" {
		t.Errorf("allowed variables changed: %v", got)
	}
	if v, ok := got["OPENROUTER_API_KEY"]; !ok || v != "" {
		t.Errorf("an empty allowed variable should stay empty and set: %q, %v", v, ok)
	}

	// Nothing else: the environment is exactly the allowlist that was set.
	var names []string
	for name := range got {
		// The stub's own shell sets these after the wrapper is gone.
		if name == "PWD" || name == "SHLVL" || name == "_" {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	want := "BACKUP_AGE_RECIPIENT BACKUP_CRON DATABASE_URL HOME HOSTNAME OPENROUTER_API_KEY PATH WORKER_API_KEY"
	if strings.Join(names, " ") != want {
		t.Errorf("environment names = %v, want %s", names, want)
	}
}

func TestEntrypointNamesWhatItDrops(t *testing.T) {
	_, stderr, err := runWrapper(t, "SOME_CLOUD_TOKEN=abc123")
	if err != nil {
		t.Fatalf("wrapper failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stderr, "SOME_CLOUD_TOKEN") || !strings.Contains(stderr, "SUPERUSER_URL_COPY") {
		t.Errorf("dropped names not reported:\n%s", stderr)
	}
	for _, secret := range []string{"abc123", wrapperSuperPassword, "my-own-secret"} {
		if strings.Contains(stderr, secret) {
			t.Errorf("stderr holds a value: %q", secret)
		}
	}
}

// A failed owner-url must stop the container: the wrapper never starts the
// sidecar with the superuser URL instead.
func TestEntrypointDoesNotStartTheSidecarWhenTheOwnerURLFails(t *testing.T) {
	got, stderr, err := runWrapper(t, "STUB_FAIL=1")
	if err == nil {
		t.Fatalf("wrapper succeeded:\n%s", stderr)
	}
	if got != nil {
		t.Fatalf("the sidecar started anyway with %v", got)
	}
	if !strings.Contains(stderr, "not started") {
		t.Errorf("no clear message:\n%s", stderr)
	}
}

func TestEntrypointDoesNotStartTheSidecarWithoutAURL(t *testing.T) {
	got, _, err := runWrapper(t, "STUB_OWNER_URL=")
	if err == nil || got != nil {
		t.Fatalf("started without a URL: %v, %v", got, err)
	}
}

// The helper's own check on a URL it was not given.
func TestOwnerURLCommandNeedsDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	var stdout, stderr bytes.Buffer
	if code := runOwnerURL(&stdout, &stderr); code == 0 || stdout.Len() != 0 {
		t.Fatalf("code %d, stdout %q", code, stdout.String())
	}
}
