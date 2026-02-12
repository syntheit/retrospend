package db

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	Pool *pgxpool.Pool
}

func Connect(databaseURL string) (*DB, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database URL: %w", err)
	}

	// Connection pool settings
	config.MaxConns = 10
	config.MinConns = 2
	config.MaxConnLifetime = time.Hour
	config.MaxConnIdleTime = 30 * time.Minute
	config.HealthCheckPeriod = time.Minute

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("✓ Database connection established")

	return &DB{Pool: pool}, nil
}

func (db *DB) Close() {
	db.Pool.Close()
	log.Println("✓ Database connection closed")
}

func (db *DB) UpdateWorkerStatus(ctx context.Context, taskName string, success bool) error {
	// Simple JSON payload
	statusJSON := fmt.Sprintf(`{"lastRun": "%s", "success": %t, "task": "%s"}`, 
		time.Now().Format(time.RFC3339), success, taskName)

	_, err := db.Pool.Exec(ctx, `
		INSERT INTO system_status (key, value, "updatedAt")
		VALUES ($1, $2::jsonb, NOW())
		ON CONFLICT (key) 
		DO UPDATE SET value = $2::jsonb, "updatedAt" = NOW()
	`, "worker_heartbeat", statusJSON)

	return err
}
