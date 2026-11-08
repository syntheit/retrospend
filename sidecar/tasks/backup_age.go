package tasks

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"filippo.io/age"
)

// ErrInvalidAgeRecipient is the stable code for a BACKUP_AGE_RECIPIENT entry that
// is not an age public key. The key itself is never put in the error or the log.
var ErrInvalidAgeRecipient = errors.New("backup_age_recipient_invalid")

// parseAgeRecipients turns age1... public keys into recipients. The age library's
// own error repeats the key, so it is dropped here.
func parseAgeRecipients(keys []string) ([]age.Recipient, error) {
	if len(keys) == 0 {
		return nil, fmt.Errorf("%w: none set", ErrInvalidAgeRecipient)
	}
	out := make([]age.Recipient, 0, len(keys))
	for _, k := range keys {
		r, err := age.ParseX25519Recipient(k)
		if err != nil {
			return nil, ErrInvalidAgeRecipient
		}
		out = append(out, r)
	}
	return out, nil
}

// encryptStream reads src and writes it to outPath, encrypted to every recipient.
// The plain bytes never touch the disk. On any failure nothing is left at
// outPath: a backup is either encrypted or absent.
func encryptStream(src io.Reader, outPath string, recipients []age.Recipient) (err error) {
	f, err := os.OpenFile(outPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			f.Close()
			os.Remove(outPath)
		}
	}()
	w, err := age.Encrypt(f, recipients...)
	if err != nil {
		return err
	}
	if _, err = io.Copy(w, src); err != nil {
		return err
	}
	if err = w.Close(); err != nil {
		return err
	}
	return f.Close()
}

// dumpEncrypted runs a pg_dump command that writes to stdout and encrypts the
// stream into outPath. Keys are checked before pg_dump starts, so a malformed
// key runs nothing and writes nothing. It returns pg_dump's stderr.
func dumpEncrypted(dump *exec.Cmd, outPath string, recipientKeys []string) ([]byte, error) {
	recipients, err := parseAgeRecipients(recipientKeys)
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	dump.Stderr = &stderr
	stdout, err := dump.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := dump.Start(); err != nil {
		return stderr.Bytes(), err
	}
	encErr := encryptStream(stdout, outPath, recipients)
	if encErr != nil {
		// Drain so pg_dump can exit instead of blocking on a closed pipe.
		io.Copy(io.Discard, stdout)
	}
	dumpErr := dump.Wait()
	if dumpErr != nil {
		os.Remove(outPath)
		return stderr.Bytes(), dumpErr
	}
	return stderr.Bytes(), encErr
}

func backupFilename(timestamp string, encrypt bool) string {
	name := fmt.Sprintf("retrospend-%s.dump", timestamp)
	if encrypt {
		name += ".age"
	}
	return name
}

// pgDumpArgs asks pg_dump to write to a file, or to stdout when the stream is
// encrypted, so the plain dump is never a file.
func pgDumpArgs(host, port, user, dbname, outPath string, encrypt bool) []string {
	args := []string{
		"--format=custom",
		"--no-owner",
		"--no-privileges",
		"--host", host,
		"--port", port,
		"--username", user,
		"--dbname", dbname,
	}
	if !encrypt {
		args = append(args, fmt.Sprintf("--file=%s", outPath))
	}
	return args
}

func isBackupFile(name string) bool {
	return strings.HasSuffix(name, ".dump") || strings.HasSuffix(name, ".dump.age")
}
