package main

import (
	"context"
	"crypto/subtle"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"importer/internal/adapters"
	"importer/internal/config"
	"importer/internal/llm"
	"importer/internal/models"
	"importer/internal/pdf"
	"importer/internal/processor"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

var Version = "0.1.2"

func main() {
	log.Printf("Retrospend Importer Worker %s starting...", Version)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	validCategories := []string{"Groceries", "Dining Out", "Cafe", "Food Delivery", "Health", "Transport", "Travel", "Misc", "Social", "Education", "Transfer"}

	// Auth middleware
	authMiddleware := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			expected := "Bearer " + cfg.WorkerAPIKey

			if subtle.ConstantTimeCompare([]byte(authHeader), []byte(expected)) != 1 {
				log.Printf("⚠️ Unauthorized access attempt from %s", r.RemoteAddr)
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}

	// Message types for NDJSON streaming
	type StreamMessage struct {
		Type     string                 `json:"type"`
		Percent  float64                `json:"percent,omitempty"`
		Message  string                 `json:"message,omitempty"`
		Data     interface{}            `json:"data,omitempty"`
		Metadata *models.ImportMetadata `json:"metadata,omitempty"`
	}

	// Process endpoint
	http.HandleFunc("/process", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Set up NDJSON streaming
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		flusher, ok := w.(http.Flusher)
		if !ok {
			log.Println("Streaming not supported by response writer")
		}

		sendProgress := func(percent float64, message string) {
			msg := StreamMessage{
				Type:    "progress",
				Percent: percent,
				Message: message,
			}
			json.NewEncoder(w).Encode(msg)
			if flusher != nil {
				flusher.Flush()
			}
		}

		// Parse multipart form
		err := r.ParseMultipartForm(10 << 20) // 10MB max
		if err != nil {
			http.Error(w, "Failed to parse form", http.StatusBadRequest)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "File is required", http.StatusBadRequest)
			return
		}
		defer file.Close()

		ext := strings.ToLower(filepath.Ext(header.Filename))
		log.Printf("[HTTP] Processing file: %s (%s)", header.Filename, ext)

		var transactions []models.NormalizedTransaction
		var metadata *models.ImportMetadata

		// Create a temp file to store the upload since some parsers might need seek or filesystem access
		tempFile, err := os.CreateTemp("", "import-*"+ext)
		if err != nil {
			log.Printf("Failed to create temp file: %v", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		defer os.Remove(tempFile.Name())
		defer tempFile.Close()

		if _, err := io.Copy(tempFile, file); err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}

		defaultCurrency := r.FormValue("currency")

		// Determine LLM provider based on request
		providerName := r.FormValue("provider")
		var provider llm.Provider
		activeModel := cfg.LLMModel
		enrichConcurrency := cfg.EnrichConcurrency
		pdfConcurrency := cfg.PDFConcurrency

		if providerName == "openrouter" && cfg.OpenRouterAPIKey != "" {
			provider = llm.NewOpenRouterProvider(cfg.OpenRouterAPIKey)
			activeModel = cfg.OpenRouterModel
			enrichConcurrency = 20  // OpenRouter handles higher concurrency
			pdfConcurrency = 10
			log.Printf("[HTTP] Using OpenRouter provider (model: %s)", activeModel)
		} else {
			if providerName == "openrouter" {
				log.Printf("[HTTP] WARNING: OpenRouter requested but API key not configured, falling back to Ollama")
			}
			provider = llm.NewOllamaProvider(cfg.OllamaEndpoint)
			log.Printf("[HTTP] Using Ollama provider (model: %s)", activeModel)
		}

		if ext == ".csv" {
			if _, err := tempFile.Seek(0, 0); err != nil {
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}
			transactions, metadata, err = handleCSV(tempFile, provider, activeModel, cfg.EnrichBatchSize, enrichConcurrency, validCategories, defaultCurrency, sendProgress)
		} else if ext == ".pdf" {
			transactions, metadata, err = handlePDF(tempFile.Name(), provider, activeModel, cfg.EnrichBatchSize, enrichConcurrency, pdfConcurrency, validCategories, defaultCurrency, sendProgress)
		} else {
			http.Error(w, "Unsupported file format", http.StatusBadRequest)
			return
		}

		if err != nil {
			log.Printf("Processing failed: %v", err)
			errMsg := StreamMessage{
				Type:     "error",
				Message:  fmt.Sprintf("Processing failed: %v", err),
				Metadata: metadata,
			}
			json.NewEncoder(w).Encode(errMsg)
			return
		}

		log.Printf("[HTTP] File processed successfully (transactions: %d)", len(transactions))

		// Send warnings if any
		if metadata != nil && len(metadata.Warnings) > 0 {
			for _, warning := range metadata.Warnings {
				warningMsg := StreamMessage{
					Type:    "warning",
					Message: warning,
				}
				json.NewEncoder(w).Encode(warningMsg)
				if flusher != nil {
					flusher.Flush()
				}
			}
		}

		// Send final result
		resultMsg := StreamMessage{
			Type:     "result",
			Data:     transactions,
			Metadata: metadata,
		}
		json.NewEncoder(w).Encode(resultMsg)
	}))

	startTime := time.Now()
	// Health endpoint (public)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":         "ok",
			"uptime_seconds": int64(time.Since(startTime).Seconds()),
			"version":        Version,
		})
	})

	// Create HTTP server with graceful shutdown support
	server := &http.Server{
		Addr:         ":" + cfg.Port,
		ReadTimeout:  10 * time.Minute, // Long timeout for large file uploads
		WriteTimeout: 10 * time.Minute, // Long timeout for LLM processing
		IdleTimeout:  120 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Printf("✓ HTTP server listening on :%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("🛑 Shutting down gracefully...")

	// Create shutdown context with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Attempt graceful shutdown
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	} else {
		log.Println("✓ HTTP server stopped gracefully")
	}

	log.Println("✓ Worker stopped")
}

func handleCSV(file *os.File, provider llm.Provider, model string, batchSize int, enrichConcurrency int, categories []string, defaultCurrency string, onProgress func(float64, string)) ([]models.NormalizedTransaction, *models.ImportMetadata, error) {
	metadata := &models.ImportMetadata{
		Warnings: []string{},
	}
	totalTokens := 0

	if onProgress != nil {
		onProgress(0.1, "Detecting CSV format...")
	}
	reader := csv.NewReader(file)
	headers, err := reader.Read()
	if err != nil {
		return nil, metadata, fmt.Errorf("could not read headers: %w", err)
	}

	var sampleRows []string
	for i := 0; i < 3; i++ {
		row, err := reader.Read()
		if err != nil {
			break
		}
		sampleRows = append(sampleRows, strings.Join(row, ","))
	}

	adapter, schemaTokens, err := adapters.DetectAdapter(provider, model, headers, sampleRows)
	totalTokens += schemaTokens
	if err != nil {
		return nil, metadata, err
	}

	if onProgress != nil {
		onProgress(0.2, "Parsing transactions...")
	}

	if _, err = file.Seek(0, 0); err != nil {
		return nil, metadata, fmt.Errorf("failed to seek: %w", err)
	}

	parsedTransactions, err := adapter.Parse(file)
	if err != nil {
		return nil, metadata, fmt.Errorf("parse error: %w", err)
	}

	for i := range parsedTransactions {
		parsedTransactions[i].Currency = processor.NormalizeCurrency(parsedTransactions[i].Currency)
		parsedTransactions[i].OriginalCurrency = processor.NormalizeCurrency(parsedTransactions[i].OriginalCurrency)
	}

	processor.ApplyExchangeRates(parsedTransactions, defaultCurrency)
	processor.NormalizeDate(parsedTransactions)
	parsedTransactions = processor.FilterPayments(parsedTransactions)

	if onProgress != nil {
		onProgress(0.3, "Enriching transactions...")
	}

	enrichedTx, enrichMetadata, enrichTokens, err := llm.EnrichTransactions(provider, model, parsedTransactions, categories, batchSize, enrichConcurrency, func(p float64, m string) {
		if onProgress != nil {
			onProgress(0.3+(p*0.7), m)
		}
	})
	totalTokens += enrichTokens
	if err != nil {
		log.Printf("WARNING: enrichment error: %v (using raw data)", err)
		metadata.Warnings = append(metadata.Warnings, fmt.Sprintf("Enrichment failed: %v", err))

		validatedTx := processor.ValidateTransactions(parsedTransactions, metadata)
		metadata.TotalTransactions = len(validatedTx)
		metadata.TotalTokensUsed = totalTokens
		return validatedTx, metadata, nil
	}

	metadata.TotalChunks = enrichMetadata.TotalChunks
	metadata.SuccessfulChunks = enrichMetadata.SuccessfulChunks
	metadata.FailedChunks = enrichMetadata.FailedChunks
	metadata.TotalTransactions = enrichMetadata.TotalTransactions
	metadata.Warnings = append(metadata.Warnings, enrichMetadata.Warnings...)

	validatedTx := processor.ValidateTransactions(enrichedTx, metadata)
	metadata.TotalTransactions = len(validatedTx)
	metadata.TotalTokensUsed = totalTokens

	return validatedTx, metadata, nil
}

func handlePDF(filePath string, provider llm.Provider, model string, batchSize int, enrichConcurrency int, pdfConcurrency int, categories []string, defaultCurrency string, onProgress func(float64, string)) ([]models.NormalizedTransaction, *models.ImportMetadata, error) {
	metadata := &models.ImportMetadata{
		Warnings: []string{},
	}
	totalTokens := 0

	if onProgress != nil {
		onProgress(0.05, "Extracting text from PDF...")
	}
	rawText, err := pdf.ExtractTextFromPDF(filePath)
	if err != nil {
		return nil, metadata, fmt.Errorf("PDF extraction failed: %w", err)
	}

	if onProgress != nil {
		onProgress(0.1, "Parsing bank statement...")
	}

	parsedTx, parseMetadata, parseTokens, err := pdf.ParsePDFTransactions(provider, model, rawText, pdfConcurrency, func(p float64, m string) {
		if onProgress != nil {
			onProgress(0.1+(p*0.4), m)
		}
	})
	totalTokens += parseTokens
	if err != nil {
		if parseMetadata != nil {
			parseMetadata.TotalTokensUsed = totalTokens
		}
		return nil, parseMetadata, fmt.Errorf("PDF parsing failed: %w", err)
	}

	metadata.TotalChunks = parseMetadata.TotalChunks
	metadata.SuccessfulChunks = parseMetadata.SuccessfulChunks
	metadata.FailedChunks = parseMetadata.FailedChunks
	metadata.Warnings = append(metadata.Warnings, parseMetadata.Warnings...)

	processor.ApplyExchangeRates(parsedTx, defaultCurrency)
	processor.NormalizeDate(parsedTx)
	parsedTx = processor.FilterPayments(parsedTx)

	if onProgress != nil {
		onProgress(0.5, "Enriching transactions...")
	}

	enrichedTx, enrichMetadata, enrichTokens, err := llm.EnrichTransactions(provider, model, parsedTx, categories, batchSize, enrichConcurrency, func(p float64, m string) {
		if onProgress != nil {
			onProgress(0.5+(p*0.5), m)
		}
	})
	totalTokens += enrichTokens
	if err != nil {
		log.Printf("WARNING: enrichment error: %v (using raw data)", err)
		metadata.Warnings = append(metadata.Warnings, fmt.Sprintf("Enrichment failed: %v", err))

		validatedTx := processor.ValidateTransactions(parsedTx, metadata)
		metadata.TotalTransactions = len(validatedTx)
		metadata.TotalTokensUsed = totalTokens
		return validatedTx, metadata, nil
	}

	metadata.TotalChunks += enrichMetadata.TotalChunks
	metadata.SuccessfulChunks += enrichMetadata.SuccessfulChunks
	metadata.FailedChunks += enrichMetadata.FailedChunks
	metadata.TotalTransactions = enrichMetadata.TotalTransactions
	metadata.Warnings = append(metadata.Warnings, enrichMetadata.Warnings...)

	validatedTx := processor.ValidateTransactions(enrichedTx, metadata)
	metadata.TotalTransactions = len(validatedTx)
	metadata.TotalTokensUsed = totalTokens

	return validatedTx, metadata, nil
}
