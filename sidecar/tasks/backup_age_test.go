package tasks

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const testRecipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"

func requireAge(t *testing.T) {
	t.Helper()
	for _, bin := range []string{"age", "age-keygen"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skipf("%s not installed", bin)
		}
	}
}

func TestDumpEncryptedRoundTrip(t *testing.T) {
	requireAge(t)
	dir := t.TempDir()
	keyFile := filepath.Join(dir, "key.txt")
	if out, err := exec.Command("age-keygen", "-o", keyFile).CombinedOutput(); err != nil {
		t.Fatalf("age-keygen: %v %s", err, out)
	}
	pub, err := exec.Command("age-keygen", "-y", keyFile).Output()
	if err != nil {
		t.Fatal(err)
	}
	plain := strings.Repeat("PGDMP money 12345\n", 500)
	out := filepath.Join(dir, "b.dump.age")

	_, err = dumpEncrypted(exec.Command("printf", "%s", plain), out, []string{strings.TrimSpace(string(pub))})
	if err != nil {
		t.Fatal(err)
	}
	enc, _ := os.ReadFile(out)
	if bytes.Contains(enc, []byte("PGDMP")) || !bytes.HasPrefix(enc, []byte("age-encryption.org/")) {
		t.Fatal("file is not age ciphertext")
	}
	dec, err := exec.Command("age", "--decrypt", "-i", keyFile, out).Output()
	if err != nil || string(dec) != plain {
		t.Fatalf("round trip failed: %v", err)
	}
}

func TestDumpEncryptedWrongKeyCannotDecrypt(t *testing.T) {
	requireAge(t)
	dir := t.TempDir()
	other := filepath.Join(dir, "other.txt")
	if out, err := exec.Command("age-keygen", "-o", other).CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	out := filepath.Join(dir, "b.dump.age")
	if _, err := dumpEncrypted(exec.Command("printf", "secret"), out, []string{testRecipient}); err != nil {
		t.Fatal(err)
	}
	if _, err := exec.Command("age", "--decrypt", "-i", other, out).Output(); err == nil {
		t.Fatal("decrypted with the wrong key")
	}
}

func TestDumpEncryptedLeavesNothingWhenDumpFails(t *testing.T) {
	requireAge(t)
	out := filepath.Join(t.TempDir(), "b.dump.age")
	_, err := dumpEncrypted(exec.Command("sh", "-c", "printf partial; exit 3"), out, []string{testRecipient})
	if err == nil {
		t.Fatal("expected an error")
	}
	if _, statErr := os.Stat(out); statErr == nil {
		t.Fatal("partial backup left on disk")
	}
}

func TestDumpEncryptedFailsClosedWithoutAge(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no sh")
	}
	t.Setenv("PATH", t.TempDir())
	dir := t.TempDir()
	out := filepath.Join(dir, "b.dump.age")
	_, err = dumpEncrypted(exec.Command(sh, "-c", "echo plain"), out, []string{testRecipient})
	if err == nil {
		t.Fatal("expected an error when age is missing")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("files left behind: %v", entries)
	}
}

func TestIsBackupFile(t *testing.T) {
	for name, want := range map[string]bool{
		"retrospend-20260101-030000.dump":     true,
		"retrospend-20260101-030000.dump.age": true,
		"backup_manifest.json":                false,
		"notes.txt":                           false,
	} {
		if isBackupFile(name) != want {
			t.Errorf("%s: want %v", name, want)
		}
	}
}
