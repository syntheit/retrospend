package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"retrospend-worker/config"
	"retrospend-worker/db"
	"retrospend-worker/tasks"

	"github.com/robfig/cron/v3"
)

func main() {
	log.Println("🚀 Retrospend Worker starting...")

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
	defer database.Close()

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
			
			// Use constant time comparison if possible, or simple string compare for now
			if authHeader != expected {
				log.Printf("⚠️ Unauthorized access attempt from %s", r.RemoteAddr)
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}

	// Start HTTP server for manual triggers
	go func() {
		// Protected sync endpoint
		http.HandleFunc("/sync-rates", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
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

		log.Println("✓ HTTP server listening on :8080")
		if err := http.ListenAndServe(":8080", nil); err != nil {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// Start the scheduler
	c.Start()
	log.Println("✓ Scheduler started")
	log.Println("  - Exchange rates: daily at 09:05 UTC")
	log.Println("  - Recurring expenses: every 15 minutes")
	log.Println("  - HTTP Server: :8080")

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("🛑 Shutting down gracefully...")
	c.Stop()
	log.Println("✓ Worker stopped")
}
