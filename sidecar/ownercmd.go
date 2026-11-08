package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"time"

	"retrospend-sidecar/config"
)

// runOwnerURL is `sidecar owner-url`, run by entrypoint.sh before the sidecar
// itself starts. It reads DATABASE_URL (a superuser's, normally), waits for the
// app to create and hand over to the owner role, and prints the URL the
// sidecar should use on stdout and nothing else there. Logs go to stderr and
// never hold a URL or password. A non-zero exit stops the container.
func runOwnerURL(stdout, stderr io.Writer) int {
	logger := log.New(stderr, "[owner-url] ", log.LstdFlags)
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		logger.Print("DATABASE_URL environment variable is required")
		return 1
	}

	opts := config.DefaultOwnerOptions()
	opts.OwnerPassword = os.Getenv("DATABASE_OWNER_PASSWORD")
	opts.RoleWait = envSeconds("SIDECAR_OWNER_ROLE_WAIT_SECONDS", opts.RoleWait)
	opts.ReadyWait = envSeconds("SIDECAR_OWNER_READY_WAIT_SECONDS", opts.ReadyWait)
	opts.Logf = logger.Printf

	url, err := config.ResolveOwnerURL(context.Background(), databaseURL, opts)
	if err != nil {
		logger.Printf("ERROR: %v", err)
		return 1
	}
	fmt.Fprintln(stdout, url)
	return 0
}

func envSeconds(name string, fallback time.Duration) time.Duration {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return time.Duration(n) * time.Second
		}
	}
	return fallback
}
