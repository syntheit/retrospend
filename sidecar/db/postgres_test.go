package db

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestPoolConfigSetsIdleInTransactionTimeout(t *testing.T) {
	config, err := poolConfig("postgres://user:pass@localhost:5432/retrospend")
	if err != nil {
		t.Fatal(err)
	}
	got := config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"]
	if got != "120000" {
		t.Fatalf("idle_in_transaction_session_timeout = %q, want 120000", got)
	}
}

// TestConnectAppliesIdleInTransactionTimeout checks the server's view of the
// setting; it skips unless SIDECAR_TEST_DATABASE_URL names a test database.
func TestConnectAppliesIdleInTransactionTimeout(t *testing.T) {
	url := os.Getenv("SIDECAR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("SIDECAR_TEST_DATABASE_URL not set")
	}
	if !strings.Contains(url, "/retrospend_test") {
		t.Fatalf("SIDECAR_TEST_DATABASE_URL must name a retrospend_test database")
	}
	database, err := Connect(url)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	var got string
	err = database.Pool.QueryRow(context.Background(),
		"SELECT current_setting('idle_in_transaction_session_timeout')").Scan(&got)
	if err != nil {
		t.Fatal(err)
	}
	if got != "2min" {
		t.Fatalf("server reports %q, want 2min", got)
	}
}
