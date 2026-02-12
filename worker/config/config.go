package config

import (
	"fmt"
	"os"
)

type Config struct {
	DatabaseURL string
	LogLevel    string
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

	return &Config{
		DatabaseURL: dbURL,
		LogLevel:    logLevel,
	}, nil
}
