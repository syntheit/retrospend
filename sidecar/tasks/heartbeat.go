package tasks

import (
	"context"

	"retrospend-sidecar/db"
)

// Heartbeat records that the sidecar is alive (system_status
// worker_heartbeat), which the admin page reads with a 20-minute window.
// Recurring posts have their own status row, written by the app.
func Heartbeat(database *db.DB) error {
	return database.UpdateWorkerStatus(context.Background(), "heartbeat", true)
}
