package config

import (
	"fmt"
	"os"
)

type Config struct {
	OllamaEndpoint string
	LogLevel       string
	Port           string
	WorkerAPIKey   string
	LLMModel       string
}

func Load() (*Config, error) {
	ollama := os.Getenv("OLLAMA_ENDPOINT")
	if ollama == "" {
		ollama = "http://localhost:11434/api/generate"
	}

	apiKey := os.Getenv("WORKER_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("WORKER_API_KEY environment variable is required")
	}

	model := os.Getenv("LLM_MODEL")
	if model == "" {
		model = "qwen2.5:7b"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = "info"
	}

	return &Config{
		OllamaEndpoint: ollama,
		LogLevel:       logLevel,
		Port:           port,
		WorkerAPIKey:   apiKey,
		LLMModel:       model,
	}, nil
}
