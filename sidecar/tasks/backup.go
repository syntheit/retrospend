package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"retrospend-sidecar/db"

	"github.com/robfig/cron/v3"
)

type BackupResult struct {
	Timestamp  time.Time `json:"timestamp"`
	Filename   string    `json:"filename"`
	SizeBytes  int64     `json:"sizeBytes"`
	DurationMs int64     `json:"durationMs"`
	Success    bool      `json:"success"`
	Encrypted  bool      `json:"encrypted,omitempty"`
	// Kind is "keystore" for the data keys dump and empty for the main one.
	Kind  string `json:"kind,omitempty"`
	Error string `json:"error,omitempty"`
}

type BackupStatus struct {
	Available     bool          `json:"available"`
	Running       bool          `json:"running"`
	LastBackup    *BackupResult `json:"lastBackup,omitempty"`
	NextScheduled *time.Time    `json:"nextScheduled,omitempty"`
	RetentionDays int           `json:"retentionDays"`
	// The keystore dump has its own last run; it is not counted in the totals
	// or the history here.
	LastKeystoreBackup *BackupResult  `json:"lastKeystoreBackup,omitempty"`
	TotalBackups       int            `json:"totalBackups"`
	TotalSize          int64          `json:"totalSize"`
	History            []BackupResult `json:"history"`
}

// Tests replace these to run RunBackup against a fake pg_dump and a fixed clock.
var (
	pgDumpBin = "pg_dump"
	backupNow = time.Now
)

var (
	backupMu  sync.Mutex
	isRunning bool
)

// IsBackupRunning returns whether a backup is currently in progress.
func IsBackupRunning() bool {
	backupMu.Lock()
	defer backupMu.Unlock()
	return isRunning
}

// RunBackup executes pg_dump and manages the backup manifest and retention.
// With age recipients the dump is streamed through age and only the encrypted
// .dump.age file is written. The dump leaves out the keystore schema.
func RunBackup(database *db.DB, databaseURL string, backupDir string, retentionDays int, ageRecipients []string) error {
	return runBackup(mainKind, database, databaseURL, backupDir, retentionDays, ageRecipients)
}

// RunKeystoreBackup dumps only the keystore schema. Its files are pruned on their
// own, apart from the main dumps.
// It is encrypted the same way as the main dump.
func RunKeystoreBackup(database *db.DB, databaseURL string, backupDir string, retentionDays int, ageRecipients []string) error {
	return runBackup(keystoreKind, database, databaseURL, backupDir, retentionDays, ageRecipients)
}

// RunBackups makes the main dump and then the keystore dump. A failure of the
// first does not skip the second: the keys matter most when something is wrong.
func RunBackups(database *db.DB, databaseURL string, backupDir string, retentionDays int, ageRecipients []string) error {
	mainErr := RunBackup(database, databaseURL, backupDir, retentionDays, ageRecipients)
	keysErr := RunKeystoreBackup(database, databaseURL, backupDir, retentionDays, ageRecipients)
	return errors.Join(mainErr, keysErr)
}

func runBackup(kind backupKind, database *db.DB, databaseURL string, backupDir string, retentionDays int, ageRecipients []string) error {
	backupMu.Lock()
	if isRunning {
		backupMu.Unlock()
		return fmt.Errorf("backup already in progress")
	}
	isRunning = true
	backupMu.Unlock()

	defer func() {
		backupMu.Lock()
		isRunning = false
		backupMu.Unlock()
	}()

	start := backupNow()
	result := BackupResult{
		Timestamp: start,
		Success:   false,
		Kind:      kind.name,
	}

	// Parse DATABASE_URL
	host, port, user, password, dbname, err := parseDatabaseURL(databaseURL)
	if err != nil {
		result.Error = fmt.Sprintf("failed to parse DATABASE_URL: %v", err)
		log.Printf("❌ %s failed: %s", kind.label(), result.Error)
		saveResult(backupDir, result, database, kind)
		return fmt.Errorf("%s", result.Error)
	}

	// Generate filename
	timestamp := start.Format("20060102-150405")
	encrypt := len(ageRecipients) > 0
	filename := backupFilename(kind, timestamp, encrypt)
	filepath := filepath.Join(backupDir, filename)
	result.Filename = filename
	result.Encrypted = encrypt

	// Before any new bytes are written, so a full disk can still be freed by it.
	removeStalePartials(backupDir)

	// Run pg_dump. Both paths write a hidden .partial file next to the final
	// name and rename it only when complete, so a crash never leaves a
	// half-written backup that looks real.
	partial := partialPath(filepath)
	cmd := exec.Command(pgDumpBin, pgDumpArgs(kind, host, port, user, dbname, partial, encrypt)...)
	cmd.Env = append(os.Environ(), fmt.Sprintf("PGPASSWORD=%s", password))

	var output []byte
	if encrypt {
		// dumpEncrypted creates and removes its own files; this run must not
		// delete a backup it did not write.
		output, err = dumpEncrypted(cmd, filepath, ageRecipients)
	} else {
		output, err = cmd.CombinedOutput()
		if err == nil {
			err = publishPartial(partial, filepath)
		}
		if err != nil {
			os.Remove(partial)
		}
	}
	if err != nil {
		if errors.Is(err, ErrInvalidAgeRecipient) || errors.Is(err, errBackupExists) {
			result.Error = fmt.Sprintf("encrypted backup not written: %v", err)
		} else if errors.Is(err, errPublish) {
			result.Error = fmt.Sprintf("backup not published: %v", err)
		} else {
			result.Error = fmt.Sprintf("pg_dump failed: %v, output: %s", err, strings.TrimSpace(string(output)))
		}
		result.DurationMs = time.Since(start).Milliseconds()
		log.Printf("❌ %s failed: %s", kind.label(), result.Error)
		saveResult(backupDir, result, database, kind)
		return fmt.Errorf("%s", result.Error)
	}

	// Verify output file
	info, err := os.Stat(filepath)
	if err != nil {
		result.Error = fmt.Sprintf("failed to stat backup file: %v", err)
		result.DurationMs = time.Since(start).Milliseconds()
		log.Printf("❌ %s failed: %s", kind.label(), result.Error)
		saveResult(backupDir, result, database, kind)
		return fmt.Errorf("%s", result.Error)
	}

	if info.Size() < kind.minSize {
		result.Error = fmt.Sprintf("backup file too small (%d bytes), likely corrupt", info.Size())
		result.DurationMs = time.Since(start).Milliseconds()
		log.Printf("❌ %s failed: %s", kind.label(), result.Error)
		os.Remove(filepath)
		saveResult(backupDir, result, database, kind)
		return fmt.Errorf("%s", result.Error)
	}

	result.Success = true
	result.SizeBytes = info.Size()
	result.DurationMs = time.Since(start).Milliseconds()

	log.Printf("✅ %s completed: %s (%.2f MB, %dms)", kind.label(), filename, float64(result.SizeBytes)/(1024*1024), result.DurationMs)

	saveResult(backupDir, result, database, kind)

	// Clean up old backups
	cleanupOldBackups(backupDir, retentionDays, kind)

	return nil
}

// GetBackupStatus reads the manifest and computes status for the HTTP endpoint.
func GetBackupStatus(backupDir string, retentionDays int, cronScheduler *cron.Cron) BackupStatus {
	status := BackupStatus{
		Available:     true,
		Running:       IsBackupRunning(),
		RetentionDays: retentionDays,
	}

	all := readManifest(backupDir)
	var history []BackupResult
	for _, r := range all {
		if r.Kind == keystoreKind.name {
			if status.LastKeystoreBackup == nil || r.Timestamp.After(status.LastKeystoreBackup.Timestamp) {
				last := r
				status.LastKeystoreBackup = &last
			}
			continue
		}
		history = append(history, r)
	}
	status.TotalBackups = len(history)

	// Calculate total size
	for _, r := range history {
		if r.Success {
			status.TotalSize += r.SizeBytes
		}
	}

	// Sort by timestamp descending
	sort.Slice(history, func(i, j int) bool {
		return history[i].Timestamp.After(history[j].Timestamp)
	})

	// Last backup
	if len(history) > 0 {
		last := history[0]
		status.LastBackup = &last
	}

	// Return last 10 entries
	if len(history) > 10 {
		status.History = history[:10]
	} else {
		status.History = history
	}

	// Next scheduled time from cron entries
	if cronScheduler != nil {
		entries := cronScheduler.Entries()
		for _, entry := range entries {
			// Find the backup entry (it's the one with the latest ID typically)
			if !entry.Next.IsZero() {
				next := entry.Next
				// We'll use the entry with the latest schedule that hasn't run yet
				if status.NextScheduled == nil || next.Before(*status.NextScheduled) {
					status.NextScheduled = &next
				}
			}
		}
	}

	return status
}

func parseDatabaseURL(databaseURL string) (host, port, user, password, dbname string, err error) {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return "", "", "", "", "", fmt.Errorf("invalid URL: %w", err)
	}

	host = u.Hostname()
	port = u.Port()
	if port == "" {
		port = "5432"
	}

	user = u.User.Username()
	password, _ = u.User.Password()
	dbname = strings.TrimPrefix(u.Path, "/")

	if host == "" || user == "" || dbname == "" {
		return "", "", "", "", "", fmt.Errorf("incomplete database URL: need host, user, and dbname")
	}

	return host, port, user, password, dbname, nil
}

func manifestPath(backupDir string) string {
	return filepath.Join(backupDir, "backup_manifest.json")
}

func readManifest(backupDir string) []BackupResult {
	data, err := os.ReadFile(manifestPath(backupDir))
	if err != nil {
		return nil
	}

	var results []BackupResult
	if err := json.Unmarshal(data, &results); err != nil {
		log.Printf("⚠️ Failed to parse backup manifest: %v", err)
		return nil
	}

	return results
}

func writeManifest(backupDir string, results []BackupResult) {
	data, err := json.MarshalIndent(results, "", "  ")
	if err != nil {
		log.Printf("⚠️ Failed to marshal backup manifest: %v", err)
		return
	}

	if err := os.WriteFile(manifestPath(backupDir), data, 0644); err != nil {
		log.Printf("⚠️ Failed to write backup manifest: %v", err)
	}
}

func saveResult(backupDir string, result BackupResult, database *db.DB, kind backupKind) {
	// Append to manifest
	history := readManifest(backupDir)
	history = append(history, result)
	writeManifest(backupDir, history)

	if database == nil {
		return
	}

	// Update system_status table
	statusJSON := fmt.Sprintf(`{"lastRun": "%s", "success": %t, "task": "backup", "filename": "%s", "sizeBytes": %d, "durationMs": %d}`,
		result.Timestamp.Format(time.RFC3339), result.Success, result.Filename, result.SizeBytes, result.DurationMs)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := database.Pool.Exec(ctx, `
		INSERT INTO system_status (key, value, "updatedAt")
		VALUES ($1, $2::jsonb, NOW())
		ON CONFLICT (key)
		DO UPDATE SET value = $2::jsonb, "updatedAt" = NOW()
	`, kind.statusKey, statusJSON)

	if err != nil {
		log.Printf("⚠️ Failed to update backup status in database: %v", err)
	}
}

func cleanupOldBackups(backupDir string, retentionDays int, kind backupKind) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		log.Printf("⚠️ Failed to read backup directory for cleanup: %v", err)
		return
	}

	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || !isBackupFile(entry.Name()) || !ownedBy(kind, entry.Name()) {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		if info.ModTime().Before(cutoff) {
			path := filepath.Join(backupDir, entry.Name())
			if err := os.Remove(path); err != nil {
				log.Printf("⚠️ Failed to remove old backup %s: %v", entry.Name(), err)
			} else {
				removed++
			}
		}
	}

	if removed > 0 {
		log.Printf("🗑️ Cleaned up %d old %s file(s)", removed, strings.ToLower(kind.label()))

		// Also clean manifest entries older than retention
		history := readManifest(backupDir)
		var kept []BackupResult
		for _, r := range history {
			if r.Kind != kind.name || r.Timestamp.After(cutoff) {
				kept = append(kept, r)
			}
		}
		if len(kept) != len(history) {
			writeManifest(backupDir, kept)
		}
	}
}

// ownedBy tells the two kinds apart by file name, so retention for one kind
// never removes the other's files.
func ownedBy(kind backupKind, name string) bool {
	return strings.HasPrefix(name, keystoreKind.prefix+"-") == (kind.name == keystoreKind.name)
}
