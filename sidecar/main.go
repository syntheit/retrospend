package main

import (
	"context"
	"crypto/subtle"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"retrospend-sidecar/config"
	"retrospend-sidecar/db"
	"retrospend-sidecar/importer/adapters"
	"retrospend-sidecar/importer/llm"
	"retrospend-sidecar/importer/models"
	"retrospend-sidecar/importer/pdf"
	"retrospend-sidecar/importer/processor"
	"retrospend-sidecar/tasks"

	"github.com/robfig/cron/v3"
)

var Version = "0.2.0"

func main() {
	log.Printf("Retrospend Sidecar %s starting...", Version)

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Connect to database
	database, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Initialize cron scheduler
	c := cron.New(cron.WithLogger(cron.VerbosePrintfLogger(log.New(os.Stdout, "[CRON] ", log.LstdFlags))))

	// Schedule exchange rate sync: daily at 09:05 UTC
	_, err = c.AddFunc("5 9 * * *", func() {
		if err := tasks.SyncExchangeRates(database); err != nil {
			log.Printf("❌ Exchange rate sync failed: %v", err)
		}
	})
	if err != nil {
		log.Fatalf("Failed to schedule exchange rate sync: %v", err)
	}

	// Schedule recurring expense processing: every 15 minutes
	_, err = c.AddFunc("*/15 * * * *", func() {
		if err := tasks.ProcessRecurringExpenses(database); err != nil {
			log.Printf("❌ Recurring expense processing failed: %v", err)
		}
	})
	if err != nil {
		log.Fatalf("Failed to schedule recurring expense processing: %v", err)
	}

	// Schedule database backup
	_, err = c.AddFunc(cfg.BackupCron, func() {
		if err := tasks.RunBackup(database, cfg.DatabaseURL, cfg.BackupDir, cfg.BackupRetentionDays); err != nil {
			log.Printf("❌ Database backup failed: %v", err)
		}
	})
	if err != nil {
		log.Fatalf("Failed to schedule database backup: %v", err)
	}

	// Schedule data retention cleanup: daily at 03:00 UTC
	_, err = c.AddFunc("0 3 * * *", func() {
		report, err := tasks.RunDataRetentionCleanup(database)
		if err != nil {
			log.Printf("❌ Data retention cleanup failed: %v", err)
			return
		}
		log.Printf("✓ Data retention cleanup complete: %s", report)
	})
	if err != nil {
		log.Fatalf("Failed to schedule data retention cleanup: %v", err)
	}

	// Schedule settlement auto-finalization: daily at 04:00 UTC
	_, err = c.AddFunc("0 4 * * *", func() {
		if err := tasks.AutoFinalizeSettlements(database); err != nil {
			log.Printf("❌ Settlement auto-finalization failed: %v", err)
		}
	})
	if err != nil {
		log.Fatalf("Failed to schedule settlement auto-finalization: %v", err)
	}

	// Check for API key
	apiKey := os.Getenv("WORKER_API_KEY")
	if apiKey == "" {
		log.Fatal("WORKER_API_KEY environment variable is not set")
	}

	// Auth middleware
	authMiddleware := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			expected := "Bearer " + apiKey

			if subtle.ConstantTimeCompare([]byte(authHeader), []byte(expected)) != 1 {
				log.Printf("⚠️ Unauthorized access attempt from %s", r.RemoteAddr)
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}

	// Check importer availability — use raw env vars, not config defaults.
	// OllamaEndpoint always has a default, so checking the config value
	// would make importerAvailable unconditionally true.
	importerAvailable := os.Getenv("OLLAMA_ENDPOINT") != "" || cfg.OpenRouterAPIKey != ""
	validCategories := []string{"Groceries", "Dining Out", "Cafe", "Food Delivery", "Health", "Transport", "Travel", "Misc", "Social", "Education", "Transfer"}

	mux := http.NewServeMux()

	// ── Worker routes ──────────────────────────────────────────────

	mux.HandleFunc("/sync-rates", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		log.Println("[HTTP] Manual sync triggered")
		if err := tasks.SyncExchangeRates(database); err != nil {
			log.Printf("[HTTP] Sync failed: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Sync successful"))
	}))

	mux.HandleFunc("/backups", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		status := tasks.GetBackupStatus(cfg.BackupDir, cfg.BackupRetentionDays, c)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	}))

	mux.HandleFunc("/backups/run", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if tasks.IsBackupRunning() {
			http.Error(w, "Backup already in progress", http.StatusConflict)
			return
		}

		log.Println("[HTTP] Manual backup triggered")

		go func() {
			if err := tasks.RunBackup(database, cfg.DatabaseURL, cfg.BackupDir, cfg.BackupRetentionDays); err != nil {
				log.Printf("[HTTP] Backup failed: %v", err)
			}
		}()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "accepted",
			"message": "Backup started",
		})
	}))

	mux.HandleFunc("/cleanup/run", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		log.Println("[HTTP] Manual data retention cleanup triggered")

		go func() {
			report, err := tasks.RunDataRetentionCleanup(database)
			if err != nil {
				log.Printf("[HTTP] Cleanup failed: %v", err)
				return
			}
			log.Printf("[HTTP] Cleanup complete: %s", report)
		}()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "accepted",
			"message": "Data retention cleanup started",
		})
	}))

	// ── Importer routes ────────────────────────────────────────────

	// Message types for NDJSON streaming
	type StreamMessage struct {
		Type     string                 `json:"type"`
		Percent  float64                `json:"percent,omitempty"`
		Message  string                 `json:"message,omitempty"`
		Data     interface{}            `json:"data,omitempty"`
		Metadata *models.ImportMetadata `json:"metadata,omitempty"`
	}

	mux.HandleFunc("/process", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Guard: require at least one LLM provider
		if !importerAvailable {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{
				"type":    "error",
				"message": "No LLM provider configured",
			})
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

		// Create a temp file
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
			enrichConcurrency = 20
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

	// ── Health endpoint (public) ───────────────────────────────────

	startTime := time.Now()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":             "ok",
			"uptime_seconds":     int64(time.Since(startTime).Seconds()),
			"version":            Version,
			"importer_available": importerAvailable,
		})
	})

	// Create HTTP server
	server := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  10 * time.Minute,
		WriteTimeout: 10 * time.Minute,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Println("✓ HTTP server listening on :8080")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// Start the scheduler
	c.Start()
	log.Println("✓ Scheduler started")
	log.Println("  - Exchange rates: daily at 09:05 UTC")
	log.Println("  - Recurring expenses: every 15 minutes")
	log.Printf("  - Database backup: %s (retention: %d days)", cfg.BackupCron, cfg.BackupRetentionDays)
	log.Println("  - Data retention cleanup: daily at 03:00 UTC")
	log.Println("  - Settlement auto-finalize: daily at 04:00 UTC")
	log.Println("  - HTTP Server: :8080")
	if importerAvailable {
		log.Println("  - Importer: available")
	} else {
		log.Println("  - Importer: no LLM provider configured")
	}

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("🛑 Shutting down gracefully...")
	c.Stop()

	// Graceful shutdown with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	} else {
		log.Println("✓ HTTP server stopped gracefully")
	}

	database.Close()
	log.Println("✓ Sidecar stopped")
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
