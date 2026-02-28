package main

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
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
	"sync"
	"syscall"
	"time"
)

var Version = "0.1.1"

// FileChecksumTracker tracks processed files to prevent duplicate imports
type FileChecksumTracker struct {
	mu         sync.RWMutex
	checksums  map[string]time.Time // checksum -> timestamp
	filePath   string
	maxAge     time.Duration
}

func NewFileChecksumTracker(filePath string, maxAge time.Duration) *FileChecksumTracker {
	tracker := &FileChecksumTracker{
		checksums: make(map[string]time.Time),
		filePath:  filePath,
		maxAge:    maxAge,
	}
	tracker.load()
	return tracker
}

func (t *FileChecksumTracker) load() {
	data, err := os.ReadFile(t.filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("Warning: failed to read checksum tracker: %v", err)
		}
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if err := json.Unmarshal(data, &t.checksums); err != nil {
		log.Printf("Warning: failed to parse checksum tracker: %v", err)
		t.checksums = make(map[string]time.Time)
	}

	// Clean up old entries
	now := time.Now()
	for checksum, timestamp := range t.checksums {
		if now.Sub(timestamp) > t.maxAge {
			delete(t.checksums, checksum)
		}
	}
}

func (t *FileChecksumTracker) save() {
	t.mu.RLock()
	data, err := json.MarshalIndent(t.checksums, "", "  ")
	t.mu.RUnlock()

	if err != nil {
		log.Printf("Warning: failed to marshal checksum tracker: %v", err)
		return
	}

	if err := os.WriteFile(t.filePath, data, 0644); err != nil {
		log.Printf("Warning: failed to write checksum tracker: %v", err)
	}
}

func (t *FileChecksumTracker) HasSeen(checksum string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()

	timestamp, exists := t.checksums[checksum]
	if !exists {
		return false
	}

	// Check if expired
	if time.Now().Sub(timestamp) > t.maxAge {
		return false
	}

	return true
}

func (t *FileChecksumTracker) Mark(checksum string) {
	t.mu.Lock()
	t.checksums[checksum] = time.Now()
	t.mu.Unlock()
	t.save()
}

func computeFileChecksum(reader io.Reader) (string, error) {
	hash := sha256.New()
	if _, err := io.Copy(hash, reader); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func main() {
	log.Printf("Retrospend Importer Worker %s starting...", Version)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	validCategories := []string{"Groceries", "Dining Out", "Cafe", "Food Delivery", "Health", "Transport", "Travel", "Misc", "Social", "Education", "Transfer"}

	// Initialize checksum tracker (keep checksums for 90 days)
	checksumTracker := NewFileChecksumTracker("data/processed_files.json", 90*24*time.Hour)

	// Auth middleware
	authMiddleware := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			expected := "Bearer " + cfg.WorkerAPIKey

			if authHeader != expected {
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

		// Copy file and compute checksum simultaneously
		hash := sha256.New()
		multiWriter := io.MultiWriter(tempFile, hash)

		if _, err := io.Copy(multiWriter, file); err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}

		checksum := hex.EncodeToString(hash.Sum(nil))

		// Check if we've already processed this file
		if checksumTracker.HasSeen(checksum) {
			log.Printf("[HTTP] File already processed (checksum: %s), returning cached result", checksum[:16])
			http.Error(w, "File already processed. Please upload a different statement.", http.StatusConflict)
			return
		}

		if ext == ".csv" {
			if _, err := tempFile.Seek(0, 0); err != nil {
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}
			transactions, metadata, err = handleCSV(tempFile, cfg, validCategories, sendProgress)
		} else if ext == ".pdf" {
			transactions, metadata, err = handlePDF(tempFile.Name(), cfg, validCategories, sendProgress)
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

		// Mark file as processed
		checksumTracker.Mark(checksum)
		log.Printf("[HTTP] File processed successfully (checksum: %s, transactions: %d)", checksum[:16], len(transactions))

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

func handleCSV(file *os.File, cfg *config.Config, categories []string, onProgress func(float64, string)) ([]models.NormalizedTransaction, *models.ImportMetadata, error) {
	metadata := &models.ImportMetadata{
		Warnings: []string{},
	}

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

	adapter, err := adapters.DetectAdapter(cfg.OllamaEndpoint, cfg.LLMModel, headers, sampleRows)
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

	processor.ApplyExchangeRates(parsedTransactions)
	processor.NormalizeDate(parsedTransactions)
	parsedTransactions = processor.FilterPayments(parsedTransactions)

	if onProgress != nil {
		onProgress(0.3, "Enriching transactions...")
	}

	enrichedTx, enrichMetadata, err := llm.EnrichTransactions(cfg.OllamaEndpoint, cfg.LLMModel, parsedTransactions, categories, func(p float64, m string) {
		if onProgress != nil {
			// Enrichment is from 0.3 to 1.0
			onProgress(0.3+(p*0.7), m)
		}
	})
	if err != nil {
		log.Printf("WARNING: enrichment error: %v (using raw data)", err)
		metadata.Warnings = append(metadata.Warnings, fmt.Sprintf("Enrichment failed: %v", err))

		// Validate raw data before returning
		validatedTx := processor.ValidateTransactions(parsedTransactions, metadata)
		metadata.TotalTransactions = len(validatedTx)
		return validatedTx, metadata, nil
	}

	// Merge enrichment metadata into main metadata
	metadata.TotalChunks = enrichMetadata.TotalChunks
	metadata.SuccessfulChunks = enrichMetadata.SuccessfulChunks
	metadata.FailedChunks = enrichMetadata.FailedChunks
	metadata.TotalTransactions = enrichMetadata.TotalTransactions
	metadata.Warnings = append(metadata.Warnings, enrichMetadata.Warnings...)

	// Validate all transactions - remove invalid ones and add warnings
	validatedTx := processor.ValidateTransactions(enrichedTx, metadata)
	metadata.TotalTransactions = len(validatedTx)

	return validatedTx, metadata, nil
}

func handlePDF(filePath string, cfg *config.Config, categories []string, onProgress func(float64, string)) ([]models.NormalizedTransaction, *models.ImportMetadata, error) {
	metadata := &models.ImportMetadata{
		Warnings: []string{},
	}

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

	parsedTx, parseMetadata, err := pdf.ParsePDFTransactions(cfg.OllamaEndpoint, cfg.LLMModel, rawText, func(p float64, m string) {
		if onProgress != nil {
			// PDF parsing is from 0.1 to 0.5
			onProgress(0.1+(p*0.4), m)
		}
	})
	if err != nil {
		return nil, parseMetadata, fmt.Errorf("PDF parsing failed: %w", err)
	}

	// Merge parse metadata
	metadata.TotalChunks = parseMetadata.TotalChunks
	metadata.SuccessfulChunks = parseMetadata.SuccessfulChunks
	metadata.FailedChunks = parseMetadata.FailedChunks
	metadata.Warnings = append(metadata.Warnings, parseMetadata.Warnings...)

	processor.ApplyExchangeRates(parsedTx)
	processor.NormalizeDate(parsedTx)
	parsedTx = processor.FilterPayments(parsedTx)

	if onProgress != nil {
		onProgress(0.5, "Enriching transactions...")
	}

	enrichedTx, enrichMetadata, err := llm.EnrichTransactions(cfg.OllamaEndpoint, cfg.LLMModel, parsedTx, categories, func(p float64, m string) {
		if onProgress != nil {
			// Enrichment is from 0.5 to 1.0
			onProgress(0.5+(p*0.5), m)
		}
	})
	if err != nil {
		log.Printf("WARNING: enrichment error: %v (using raw data)", err)
		metadata.Warnings = append(metadata.Warnings, fmt.Sprintf("Enrichment failed: %v", err))

		// Validate raw data before returning
		validatedTx := processor.ValidateTransactions(parsedTx, metadata)
		metadata.TotalTransactions = len(validatedTx)
		return validatedTx, metadata, nil // graceful fallback to raw data
	}

	// Merge enrichment metadata (add to existing chunk counts from parsing)
	metadata.TotalChunks += enrichMetadata.TotalChunks
	metadata.SuccessfulChunks += enrichMetadata.SuccessfulChunks
	metadata.FailedChunks += enrichMetadata.FailedChunks
	metadata.TotalTransactions = enrichMetadata.TotalTransactions
	metadata.Warnings = append(metadata.Warnings, enrichMetadata.Warnings...)

	// Validate all transactions - remove invalid ones and add warnings
	validatedTx := processor.ValidateTransactions(enrichedTx, metadata)
	metadata.TotalTransactions = len(validatedTx)

	return validatedTx, metadata, nil
}
