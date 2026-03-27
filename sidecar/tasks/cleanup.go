package tasks

import (
	"context"
	"fmt"
	"log"
	"time"

	"retrospend-sidecar/db"
)

// RetentionReport summarises what was deleted/anonymized by RunDataRetentionCleanup.
type RetentionReport struct {
	EventLogsDeleted      int64
	TokensDeleted         int64
	MagicLinksDeleted     int64
	GuestSessionsCleaned  int64
	AuditIPsRedacted      int64
}

func (r RetentionReport) String() string {
	return fmt.Sprintf(
		"event_logs=%d tokens=%d magic_links=%d guest_sessions=%d audit_ips_redacted=%d",
		r.EventLogsDeleted,
		r.TokensDeleted,
		r.MagicLinksDeleted,
		r.GuestSessionsCleaned,
		r.AuditIPsRedacted,
	)
}

// RunDataRetentionCleanup deletes or anonymizes data that has exceeded its
// retention period. It is safe to run multiple times (idempotent).
//
// Retention rules:
//   - EventLog entries older than 12 months → deleted
//   - Expired VerificationToken / PasswordResetToken → deleted
//   - Revoked/inactive MagicLinks older than 90 days → deleted
//   - GuestSessions inactive for 90+ days → anonymize references then delete
//   - AuditLogEntry.context IP addresses older than 90 days → redacted in-place
func RunDataRetentionCleanup(database *db.DB) (RetentionReport, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	report := RetentionReport{}
	now := time.Now().UTC()
	twelveMonthsAgo := now.AddDate(-1, 0, 0)
	ninetyDaysAgo := now.AddDate(0, 0, -90)

	// ── 1. EventLog: delete entries older than 12 months ─────────────────────
	{
		tag, err := database.Pool.Exec(ctx,
			`DELETE FROM event_log WHERE timestamp < $1`,
			twelveMonthsAgo,
		)
		if err != nil {
			return report, fmt.Errorf("cleanup event_log: %w", err)
		}
		report.EventLogsDeleted = tag.RowsAffected()
	}

	// ── 2. Expired VerificationTokens ────────────────────────────────────────
	{
		tag, err := database.Pool.Exec(ctx,
			`DELETE FROM verification_token WHERE expires < $1`,
			now,
		)
		if err != nil {
			return report, fmt.Errorf("cleanup verification_token: %w", err)
		}
		report.TokensDeleted += tag.RowsAffected()
	}

	// ── 3. Expired PasswordResetTokens ───────────────────────────────────────
	{
		tag, err := database.Pool.Exec(ctx,
			`DELETE FROM password_reset_token WHERE expires < $1`,
			now,
		)
		if err != nil {
			return report, fmt.Errorf("cleanup password_reset_token: %w", err)
		}
		report.TokensDeleted += tag.RowsAffected()
	}

	// ── 4. Revoked/inactive MagicLinks older than 90 days ────────────────────
	{
		tag, err := database.Pool.Exec(ctx,
			`DELETE FROM magic_link WHERE "isActive" = false AND "createdAt" < $1`,
			ninetyDaysAgo,
		)
		if err != nil {
			return report, fmt.Errorf("cleanup magic_link: %w", err)
		}
		report.MagicLinksDeleted = tag.RowsAffected()
	}

	// ── 5. Expired guest sessions (inactive 90+ days) ────────────────────────
	//
	// For each expired session, anonymize all references with the
	// "DELETED_GUEST" sentinel before deleting the session record.
	// We batch-process by fetching IDs first to keep individual statements small.
	{
		rows, err := database.Pool.Query(ctx,
			`SELECT id FROM guest_session WHERE "lastActiveAt" < $1`,
			ninetyDaysAgo,
		)
		if err != nil {
			return report, fmt.Errorf("query expired guest sessions: %w", err)
		}

		var expiredIDs []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return report, fmt.Errorf("scan guest session id: %w", err)
			}
			expiredIDs = append(expiredIDs, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return report, fmt.Errorf("iterate guest session rows: %w", err)
		}

		for _, guestID := range expiredIDs {
			if err := anonymizeExpiredGuest(ctx, database, guestID); err != nil {
				// Log and continue — partial cleanup is better than none.
				log.Printf("⚠️  cleanup: failed to anonymize guest session %s: %v", guestID, err)
				continue
			}
			report.GuestSessionsCleaned++
		}
	}

	// ── 6. AuditLogEntry: redact IP addresses older than 90 days ─────────────
	//
	// Sets context->'ip' to "redacted" for entries that have an ip key.
	// Other fields in context (project changes, amounts, etc.) are preserved.
	{
		tag, err := database.Pool.Exec(ctx,
			`UPDATE audit_log_entry
			    SET context = jsonb_set(context, '{ip}', '"redacted"')
			  WHERE timestamp < $1
			    AND context IS NOT NULL
			    AND context ? 'ip'
			    AND context->>'ip' != 'redacted'`,
			ninetyDaysAgo,
		)
		if err != nil {
			return report, fmt.Errorf("redact audit_log_entry ips: %w", err)
		}
		report.AuditIPsRedacted = tag.RowsAffected()
	}

	return report, nil
}

// anonymizeExpiredGuest replaces all participantId references for the given
// guest session with the "DELETED_GUEST" sentinel, then deletes the session.
// All writes run in a single transaction so the state is always consistent.
func anonymizeExpiredGuest(ctx context.Context, database *db.DB, guestID string) error {
	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	const sentinel = "DELETED_GUEST"

	stmts := []struct {
		sql  string
		desc string
	}{
		// SplitParticipant anonymization uses a merge-on-conflict pattern because of
		// @@unique([transactionId, participantType, participantId]): if DELETED_GUEST
		// already exists in a transaction (from a prior guest deletion), a plain UPDATE
		// would fail with a unique-constraint violation.
		//   Step 1: merge shareAmount into the pre-existing DELETED_GUEST row.
		{
			`UPDATE split_participant AS target
			    SET "shareAmount" = target."shareAmount" + source."shareAmount"
			   FROM split_participant AS source
			  WHERE source."participantType" = 'guest'
			    AND source."participantId"   = $2
			    AND target."transactionId"   = source."transactionId"
			    AND target."participantType" = 'guest'
			    AND target."participantId"   = $1`,
			"split_participant merge",
		},
		//   Step 2: delete the guest's row where the merge happened (to avoid conflict).
		{
			`DELETE FROM split_participant
			  WHERE "participantType" = 'guest'
			    AND "participantId"   = $2
			    AND "transactionId" IN (
			        SELECT "transactionId"
			          FROM split_participant
			         WHERE "participantType" = 'guest'
			           AND "participantId"   = $1
			    )`,
			"split_participant delete merged",
		},
		//   Step 3: update remaining rows (no conflict exists).
		{
			`UPDATE split_participant
			    SET "participantId" = $1
			  WHERE "participantType" = 'guest' AND "participantId" = $2`,
			"split_participant",
		},
		{
			`UPDATE shared_transaction
			    SET "paidById" = $1
			  WHERE "paidByType" = 'guest' AND "paidById" = $2`,
			"shared_transaction paidBy",
		},
		{
			`UPDATE shared_transaction
			    SET "createdById" = $1
			  WHERE "createdByType" = 'guest' AND "createdById" = $2`,
			"shared_transaction createdBy",
		},
		{
			`UPDATE settlement
			    SET "fromParticipantId" = $1
			  WHERE "fromParticipantType" = 'guest' AND "fromParticipantId" = $2`,
			"settlement fromParticipant",
		},
		{
			`UPDATE settlement
			    SET "toParticipantId" = $1
			  WHERE "toParticipantType" = 'guest' AND "toParticipantId" = $2`,
			"settlement toParticipant",
		},
		{
			`UPDATE audit_log_entry
			    SET "actorId" = $1
			  WHERE "actorType" = 'guest' AND "actorId" = $2`,
			"audit_log_entry actor",
		},
		{
			`DELETE FROM project_participant
			  WHERE "participantType" = 'guest' AND "participantId" = $2`,
			"project_participant",
		},
		{
			`DELETE FROM guest_session WHERE id = $2`,
			"guest_session",
		},
	}

	for _, s := range stmts {
		if _, err := tx.Exec(ctx, s.sql, sentinel, guestID); err != nil {
			return fmt.Errorf("anonymize %s for guest %s: %w", s.desc, guestID, err)
		}
	}

	return tx.Commit(ctx)
}
