package tasks

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

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

// errPublish marks a failure to move a finished backup into place, so the log
// does not blame pg_dump for it.
var errPublish = errors.New("backup_publish_failed")

// linkFile is os.Link; tests replace it to simulate a filesystem without hard links.
var linkFile = os.Link

// publishPartial makes a finished partial file the real backup: fsync the file,
// link it into place and drop the partial name, fsync the directory so the
// change survives a crash. It never replaces an existing backup.
func publishPartial(partial, finalPath string) error {
	if err := publishPartialSteps(partial, finalPath); err != nil {
		return fmt.Errorf("%w: %w", errPublish, err)
	}
	return nil
}

func publishPartialSteps(partial, finalPath string) error {
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
	// A hard link fails with EEXIST instead of replacing a backup that appeared
	// since the caller looked, which a rename would silently overwrite.
	if err := linkFile(partial, finalPath); err != nil {
		if !noHardLinks(err) {
			return err
		}
		// vfat, exFAT and some network mounts cannot hard link. Only one backup
		// runs at a time (isRunning), so check-then-rename is safe here.
		if _, statErr := os.Lstat(finalPath); statErr == nil {
			return fs.ErrExist
		}
		if err := os.Rename(partial, finalPath); err != nil {
			return err
		}
	} else {
		os.Remove(partial)
	}
	dir, err := os.Open(filepath.Dir(finalPath))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

// noHardLinks reports the errors a filesystem without hard link support returns.
func noHardLinks(err error) bool {
	return errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.ENOTSUP) ||
		errors.Is(err, syscall.EOPNOTSUPP) || errors.Is(err, syscall.ENOSYS)
}

// removeStalePartials deletes crash leftovers. A partial can be a full plaintext
// dump, so it must not wait for the retention period. Callers hold isRunning, so
// no live run owns a partial that is older than a few hours.
func removeStalePartials(backupDir string) {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-stalePartialAge)
	for _, entry := range entries {
		if entry.IsDir() || !isPartialFile(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(backupDir, entry.Name())); err != nil {
			log.Printf("⚠️ Failed to remove stale partial backup %s: %v", entry.Name(), err)
		}
	}
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

// backupKind is one of the two dumps a run can make. The keystore schema holds
// the per-user data keys: it stays out of the main dump and is dumped alone, so
// it can be kept for a much shorter time (a deleted user's key must not outlive
// them in a long-lived backup).
type backupKind struct {
	// name is the manifest tag, empty for the main dump.
	name string
	// prefix starts every file name: retrospend-... or keystore-...
	prefix string
	// schemaArgs choose what pg_dump includes.
	schemaArgs []string
	// minSize is the smallest file that can be a real dump.
	minSize int64
	// statusKey is the system_status row the result is written to.
	statusKey string
}

const keystoreSchema = "keystore"

var (
	mainKind = backupKind{
		prefix:     "retrospend",
		schemaArgs: []string{"--exclude-schema=" + keystoreSchema},
		minSize:    1024,
		statusKey:  "backup_status",
	}
	// A dump of one small table is only a few KB, so the size floor is low.
	keystoreKind = backupKind{
		name:       keystoreSchema,
		prefix:     keystoreSchema,
		schemaArgs: []string{"--schema=" + keystoreSchema},
		minSize:    1,
		statusKey:  "keystore_backup_status",
	}
)

func (k backupKind) label() string {
	if k.name == "" {
		return "Backup"
	}
	return "Keystore backup"
}

func backupFilename(k backupKind, timestamp string, encrypt bool) string {
	name := fmt.Sprintf("%s-%s.dump", k.prefix, timestamp)
	if encrypt {
		name += ".age"
	}
	return name
}

// pgDumpArgs asks pg_dump to write to a file, or to stdout when the stream is
// encrypted, so the plain dump is never a file.
func pgDumpArgs(k backupKind, host, port, user, dbname, outPath string, encrypt bool) []string {
	args := []string{
		"--format=custom",
		"--no-owner",
		"--no-privileges",
	}
	args = append(args, k.schemaArgs...)
	args = append(args,
		"--host", host,
		"--port", port,
		"--username", user,
		"--dbname", dbname,
	)
	if !encrypt {
		args = append(args, fmt.Sprintf("--file=%s", outPath))
	}
	return args
}

// stalePartialAge is how long a .partial file may sit before retention removes it.
const stalePartialAge = 6 * time.Hour

func isPartialFile(name string) bool {
	return (strings.HasPrefix(name, "."+mainKind.prefix+"-") || strings.HasPrefix(name, "."+keystoreKind.prefix+"-")) &&
		strings.HasSuffix(name, ".partial")
}

func isBackupFile(name string) bool {
	return strings.HasSuffix(name, ".dump") || strings.HasSuffix(name, ".dump.age")
}
