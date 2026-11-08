package tasks

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"filippo.io/age"
)

// ErrInvalidAgeRecipient is the stable code for a BACKUP_AGE_RECIPIENT entry that
// is not an age public key. The key itself is never put in the error or the log.
var ErrInvalidAgeRecipient = errors.New("backup_age_recipient_invalid")

// errBackupExists stops a run from touching a backup it did not write.
var errBackupExists = errors.New("backup_file_exists")

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

// partialPath is the hidden name a backup is written under until it is complete.
// It ends in .partial, so listing and retention never treat it as a backup.
func partialPath(finalPath string) string {
	return filepath.Join(filepath.Dir(finalPath), "."+filepath.Base(finalPath)+".partial")
}

// publishPartial makes a finished partial file the real backup: fsync the file,
// rename it into place, fsync the directory so the rename survives a crash.
func publishPartial(partial, finalPath string) error {
	f, err := os.OpenFile(partial, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(partial, finalPath); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(finalPath))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

// encryptStream reads src and writes it to path, encrypted to every recipient.
// The plain bytes never touch the disk. On any failure the file is removed.
func encryptStream(src io.Reader, path string, recipients []age.Recipient) (err error) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			f.Close()
			os.Remove(path)
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
// key runs nothing and writes nothing. The encrypted bytes go to a .partial file
// that is renamed to outPath only after pg_dump exits cleanly; an existing
// outPath is never touched. It returns pg_dump's stderr.
func dumpEncrypted(dump *exec.Cmd, outPath string, recipientKeys []string) (out []byte, err error) {
	recipients, err := parseAgeRecipients(recipientKeys)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Lstat(outPath); statErr == nil {
		return nil, errBackupExists
	}
	partial := partialPath(outPath)
	os.Remove(partial) // a leftover from a crashed run: this name is ours
	defer func() {
		if err != nil {
			os.Remove(partial)
		}
	}()

	var stderr bytes.Buffer
	dump.Stderr = &stderr
	stdout, err := dump.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := dump.Start(); err != nil {
		return stderr.Bytes(), err
	}
	encErr := encryptStream(stdout, partial, recipients)
	if encErr != nil {
		// Drain so pg_dump can exit instead of blocking on a closed pipe.
		io.Copy(io.Discard, stdout)
	}
	if dumpErr := dump.Wait(); dumpErr != nil {
		return stderr.Bytes(), dumpErr
	}
	if encErr != nil {
		return stderr.Bytes(), encErr
	}
	return stderr.Bytes(), publishPartial(partial, outPath)
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
