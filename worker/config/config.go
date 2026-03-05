package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL         string
	LogLevel            string
	BackupDir           string
	BackupRetentionDays int
	BackupCron          string
}

func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = "info"
	}

	backupDir := os.Getenv("BACKUP_DIR")
	if backupDir == "" {
		backupDir = "/backups"
	}

	backupRetentionDays := 30
	if v := os.Getenv("BACKUP_RETENTION_DAYS"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			backupRetentionDays = parsed
		}
	}

	backupCron := os.Getenv("BACKUP_CRON")
	if backupCron == "" {
		backupCron = "0 3 * * *"
	}

	return &Config{
		DatabaseURL:         dbURL,
		LogLevel:            logLevel,
		BackupDir:           backupDir,
		BackupRetentionDays: backupRetentionDays,
		BackupCron:          backupCron,
	}, nil
}
