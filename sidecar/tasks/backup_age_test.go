package tasks

import (
	"bytes"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"filippo.io/age"
)

func newIdentity(t *testing.T) (*age.X25519Identity, string) {
	t.Helper()
	id, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	return id, id.Recipient().String()
}

func decryptFile(t *testing.T, path string, id age.Identity) ([]byte, error) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r, err := age.Decrypt(f, id)
	if err != nil {
		return nil, err
	}
	return io.ReadAll(r)
}

func shellDump(script string) *exec.Cmd { return exec.Command("sh", "-c", script) }

func TestDumpEncryptedRoundTrip(t *testing.T) {
	id, pub := newIdentity(t)
	plain := strings.Repeat("PGDMP money 12345\n", 5000)
	out := filepath.Join(t.TempDir(), "b.dump.age")

	if _, err := dumpEncrypted(exec.Command("printf", "%s", plain), out, []string{pub}); err != nil {
		t.Fatal(err)
	}
	enc, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(enc, []byte("PGDMP")) || bytes.Contains(enc, []byte("money")) {
		t.Fatal("file contains plaintext")
	}
	if !bytes.HasPrefix(enc, []byte("age-encryption.org/")) {
		t.Fatal("file is not age ciphertext")
	}
	dec, err := decryptFile(t, out, id)
	if err != nil || !bytes.Equal(dec, []byte(plain)) {
		t.Fatalf("round trip failed: %v", err)
	}
}

func TestDumpEncryptedMultipleRecipients(t *testing.T) {
	a, pubA := newIdentity(t)
	b, pubB := newIdentity(t)
	out := filepath.Join(t.TempDir(), "b.dump.age")
	if _, err := dumpEncrypted(exec.Command("printf", "%s", "shared"), out, []string{pubA, pubB}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []age.Identity{a, b} {
		if dec, err := decryptFile(t, out, id); err != nil || string(dec) != "shared" {
			t.Fatalf("recipient cannot decrypt: %v", err)
		}
	}
}

func TestDumpEncryptedWrongKeyCannotDecrypt(t *testing.T) {
	_, pub := newIdentity(t)
	other, _ := newIdentity(t)
	out := filepath.Join(t.TempDir(), "b.dump.age")
	if _, err := dumpEncrypted(exec.Command("printf", "secret"), out, []string{pub}); err != nil {
		t.Fatal(err)
	}
	if _, err := decryptFile(t, out, other); err == nil {
		t.Fatal("decrypted with the wrong key")
	}
}

func TestDumpEncryptedMalformedKeyWritesNothing(t *testing.T) {
	_, pub := newIdentity(t)
	for _, bad := range []string{
		"not-a-key",
		"age1short",
		pub[:len(pub)-1] + "q",   // bad checksum
		"AGE-SECRET-KEY-1ABCDEF", // a private key is not a recipient
	} {
		dir := t.TempDir()
		out := filepath.Join(dir, "b.dump.age")
		marker := filepath.Join(dir, "dump-ran")
		_, err := dumpEncrypted(shellDump("touch "+marker+"; echo PLAINTEXT-MARKER"), out, []string{bad})
		if !errors.Is(err, ErrInvalidAgeRecipient) {
			t.Fatalf("%q: want ErrInvalidAgeRecipient, got %v", bad, err)
		}
		if strings.Contains(err.Error(), bad) {
			t.Fatalf("error repeats the key: %v", err)
		}
		entries, _ := os.ReadDir(dir)
		if len(entries) != 0 {
			t.Fatalf("%q: files written for a malformed key: %v", bad, entries)
		}
	}
}

func TestDumpEncryptedNoRecipientsRefuses(t *testing.T) {
	out := filepath.Join(t.TempDir(), "b.dump.age")
	if _, err := dumpEncrypted(exec.Command("printf", "x"), out, nil); err == nil {
		t.Fatal("expected an error with no recipients")
	}
	if _, err := os.Stat(out); err == nil {
		t.Fatal("file written with no recipients")
	}
}

func TestDumpEncryptedLeavesNothingWhenDumpFails(t *testing.T) {
	_, pub := newIdentity(t)
	out := filepath.Join(t.TempDir(), "b.dump.age")
	if _, err := dumpEncrypted(shellDump("printf partial; exit 3"), out, []string{pub}); err == nil {
		t.Fatal("expected an error")
	}
	if _, err := os.Stat(out); err == nil {
		t.Fatal("partial backup left on disk")
	}
}

func TestDumpEncryptedOutputIsPrivate(t *testing.T) {
	_, pub := newIdentity(t)
	out := filepath.Join(t.TempDir(), "b.dump.age")
	if _, err := dumpEncrypted(exec.Command("printf", "x"), out, []string{pub}); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(out)
	if info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("mode %v is readable by others", info.Mode().Perm())
	}
}

func TestNoKeyBackupIsUnchanged(t *testing.T) {
	if got := backupFilename(mainKind, "20260101-030000", false); got != "retrospend-20260101-030000.dump" {
		t.Fatalf("filename %q", got)
	}
	args := pgDumpArgs(mainKind, "h", "5432", "u", "d", "/b/x.dump", false)
	want := []string{"--format=custom", "--no-owner", "--no-privileges", "--exclude-schema=keystore",
		"--host", "h", "--port", "5432", "--username", "u", "--dbname", "d", "--file=/b/x.dump"}
	if strings.Join(args, " ") != strings.Join(want, " ") {
		t.Fatalf("args %v", args)
	}
}

func TestEncryptedBackupNeverAsksPgDumpForAFile(t *testing.T) {
	if got := backupFilename(mainKind, "20260101-030000", true); got != "retrospend-20260101-030000.dump.age" {
		t.Fatalf("filename %q", got)
	}
	for _, a := range pgDumpArgs(mainKind, "h", "5432", "u", "d", "/b/x.dump.age", true) {
		if strings.HasPrefix(a, "--file") {
			t.Fatalf("pg_dump would write a plain file: %v", a)
		}
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
