package tasks

import (
	"context"
	"log"
	"time"

	"retrospend-sidecar/db"
)

// AutoFinalizeSettlements finalizes PROPOSED settlements that have been
// pending for more than 7 days. This implements optimistic settlement:
// balances update immediately when a settlement is proposed, and the payee
// has 7 days to reject before it auto-confirms.
func AutoFinalizeSettlements(database *db.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cutoff := time.Now().Add(-7 * 24 * time.Hour)

	result, err := database.Pool.Exec(ctx, `
		UPDATE "Settlement"
		SET
			status = 'FINALIZED',
			"confirmedByPayee" = true,
			"settledAt" = NOW(),
			"autoConfirmedReason" = 'Auto-finalized after 7 days without response'
		WHERE
			status = 'PROPOSED'
			AND "initiatedAt" < $1
	`, cutoff)
	if err != nil {
		return err
	}

	count := result.RowsAffected()
	if count > 0 {
		log.Printf("✓ Auto-finalized %d settlement(s) older than 7 days", count)
	}

	return nil
}
