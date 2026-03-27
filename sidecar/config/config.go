package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	// Worker (required)
	DatabaseURL         string
	LogLevel            string
	BackupDir           string
	BackupRetentionDays int
	BackupCron          string
	// Importer (optional)
	OllamaEndpoint    string
	LLMModel          string
	EnrichBatchSize   int
	EnrichConcurrency int
	PDFConcurrency    int
	OpenRouterAPIKey  string
	OpenRouterModel   string
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

	ollama := os.Getenv("OLLAMA_ENDPOINT")
	if ollama == "" {
		ollama = "http://localhost:11434/api/generate"
	}

	model := os.Getenv("LLM_MODEL")
	if model == "" {
		model = "qwen2.5:7b"
	}

	openRouterAPIKey := os.Getenv("OPENROUTER_API_KEY")
	openRouterModel := os.Getenv("OPENROUTER_MODEL")
	if openRouterModel == "" {
		openRouterModel = "qwen/qwen-2.5-7b-instruct"
	}

	return &Config{
		DatabaseURL:         dbURL,
		LogLevel:            logLevel,
		BackupDir:           backupDir,
		BackupRetentionDays: backupRetentionDays,
		BackupCron:          backupCron,
		OllamaEndpoint:      ollama,
		LLMModel:            model,
		EnrichBatchSize:     getEnvInt("ENRICH_BATCH_SIZE", 20),
		EnrichConcurrency:   getEnvInt("ENRICH_CONCURRENCY", 3),
		PDFConcurrency:      getEnvInt("PDF_CONCURRENCY", 3),
		OpenRouterAPIKey:    openRouterAPIKey,
		OpenRouterModel:     openRouterModel,
	}, nil
}

func getEnvInt(key string, defaultVal int) int {
	s := os.Getenv(key)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil || v <= 0 {
		return defaultVal
	}
	return v
}
