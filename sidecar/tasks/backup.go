package tasks

import (
	"context"
	"encoding/json"
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
	Error      string    `json:"error,omitempty"`
}

type BackupStatus struct {
	Available     bool           `json:"available"`
	Running       bool           `json:"running"`
	LastBackup    *BackupResult  `json:"lastBackup,omitempty"`
	NextScheduled *time.Time     `json:"nextScheduled,omitempty"`
	RetentionDays int            `json:"retentionDays"`
	TotalBackups  int            `json:"totalBackups"`
	TotalSize     int64          `json:"totalSize"`
	History       []BackupResult `json:"history"`
}

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
func RunBackup(database *db.DB, databaseURL string, backupDir string, retentionDays int) error {
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

	start := time.Now()
	result := BackupResult{
		Timestamp: start,
		Success:   false,
	}

	// Parse DATABASE_URL
	host, port, user, password, dbname, err := parseDatabaseURL(databaseURL)
	if err != nil {
		result.Error = fmt.Sprintf("failed to parse DATABASE_URL: %v", err)
		log.Printf("❌ Backup failed: %s", result.Error)
		saveResult(backupDir, result, database)
		return fmt.Errorf("%s", result.Error)
	}

	// Generate filename
	timestamp := start.Format("20060102-150405")
	filename := fmt.Sprintf("retrospend-%s.dump", timestamp)
	filepath := filepath.Join(backupDir, filename)
	result.Filename = filename

	// Run pg_dump
	cmd := exec.Command("pg_dump",
		"--format=custom",
		"--no-owner",
		"--no-privileges",
		fmt.Sprintf("--file=%s", filepath),
		"--host", host,
		"--port", port,
		"--username", user,
		"--dbname", dbname,
	)
	cmd.Env = append(os.Environ(), fmt.Sprintf("PGPASSWORD=%s", password))

	output, err := cmd.CombinedOutput()
	if err != nil {
		result.Error = fmt.Sprintf("pg_dump failed: %v, output: %s", err, strings.TrimSpace(string(output)))
		result.DurationMs = time.Since(start).Milliseconds()
		log.Printf("❌ Backup failed: %s", result.Error)
		// Clean up partial file
		os.Remove(filepath)
		saveResult(backupDir, result, database)
		return fmt.Errorf("%s", result.Error)
	}

	// Verify output file
	info, err := os.Stat(filepath)
	if err != nil {
		result.Error = fmt.Sprintf("failed to stat backup file: %v", err)
		result.DurationMs = time.Since(start).Milliseconds()
		log.Printf("❌ Backup failed: %s", result.Error)
		saveResult(backupDir, result, database)
		return fmt.Errorf("%s", result.Error)
	}

	if info.Size() < 1024 {
		result.Error = fmt.Sprintf("backup file too small (%d bytes), likely corrupt", info.Size())
		result.DurationMs = time.Since(start).Milliseconds()
		log.Printf("❌ Backup failed: %s", result.Error)
		os.Remove(filepath)
		saveResult(backupDir, result, database)
		return fmt.Errorf("%s", result.Error)
	}

	result.Success = true
	result.SizeBytes = info.Size()
	result.DurationMs = time.Since(start).Milliseconds()

	log.Printf("✅ Backup completed: %s (%.2f MB, %dms)", filename, float64(result.SizeBytes)/(1024*1024), result.DurationMs)

	saveResult(backupDir, result, database)

	// Clean up old backups
	cleanupOldBackups(backupDir, retentionDays)

	return nil
}

// GetBackupStatus reads the manifest and computes status for the HTTP endpoint.
func GetBackupStatus(backupDir string, retentionDays int, cronScheduler *cron.Cron) BackupStatus {
	status := BackupStatus{
		Available:     true,
		Running:       IsBackupRunning(),
		RetentionDays: retentionDays,
	}

	history := readManifest(backupDir)
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

func saveResult(backupDir string, result BackupResult, database *db.DB) {
	// Append to manifest
	history := readManifest(backupDir)
	history = append(history, result)
	writeManifest(backupDir, history)

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
	`, "backup_status", statusJSON)

	if err != nil {
		log.Printf("⚠️ Failed to update backup status in database: %v", err)
	}
}

func cleanupOldBackups(backupDir string, retentionDays int) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		log.Printf("⚠️ Failed to read backup directory for cleanup: %v", err)
		return
	}

	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".dump") {
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
		log.Printf("🗑️ Cleaned up %d old backup(s)", removed)

		// Also clean manifest entries older than retention
		history := readManifest(backupDir)
		var kept []BackupResult
		for _, r := range history {
			if r.Timestamp.After(cutoff) {
				kept = append(kept, r)
			}
		}
		if len(kept) != len(history) {
			writeManifest(backupDir, kept)
		}
	}
}
