package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	OllamaEndpoint    string
	LogLevel          string
	Port              string
	WorkerAPIKey      string
	LLMModel          string
	EnrichBatchSize   int
	EnrichConcurrency int
	PDFConcurrency    int
	OpenRouterAPIKey  string
	OpenRouterModel   string
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

	enrichBatchSize := getEnvInt("ENRICH_BATCH_SIZE", 20)
	enrichConcurrency := getEnvInt("ENRICH_CONCURRENCY", 3)
	pdfConcurrency := getEnvInt("PDF_CONCURRENCY", 3)

	openRouterAPIKey := os.Getenv("OPENROUTER_API_KEY")
	openRouterModel := os.Getenv("OPENROUTER_MODEL")
	if openRouterModel == "" {
		openRouterModel = "qwen/qwen-2.5-7b-instruct"
	}

	return &Config{
		OllamaEndpoint:    ollama,
		LogLevel:          logLevel,
		Port:              port,
		WorkerAPIKey:      apiKey,
		LLMModel:          model,
		EnrichBatchSize:   enrichBatchSize,
		EnrichConcurrency: enrichConcurrency,
		PDFConcurrency:    pdfConcurrency,
		OpenRouterAPIKey:  openRouterAPIKey,
		OpenRouterModel:   openRouterModel,
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
