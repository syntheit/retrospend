-- Settlement enhancements: rejection, reminders, auto-confirm for non-users
-- Adds REJECTED status, new columns for rejection/reminder tracking, and
-- backfills non-user settlements to FINALIZED.

-- 1. Add REJECTED to SettlementStatus enum
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'REJECTED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SettlementStatus')
  ) THEN
    ALTER TYPE "SettlementStatus" ADD VALUE 'REJECTED';
  END IF;
END $$;

-- 2. Add SETTLEMENT_REJECTED to NotificationType enum
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SETTLEMENT_REJECTED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'NotificationType')
  ) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'SETTLEMENT_REJECTED';
  END IF;
END $$;

-- 3. New columns on settlement table
ALTER TABLE settlement ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMPTZ;
ALTER TABLE settlement ADD COLUMN IF NOT EXISTS "rejectedReason" VARCHAR(500);
ALTER TABLE settlement ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMPTZ;
ALTER TABLE settlement ADD COLUMN IF NOT EXISTS "reminderCount" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE settlement ADD COLUMN IF NOT EXISTS "autoConfirmedReason" VARCHAR(200);

-- 4. Backfill: auto-finalize existing PROPOSED settlements with non-user recipients.
-- These can never be confirmed since shadow/guest participants cannot authenticate.
UPDATE settlement SET
  "confirmedByPayee" = true,
  status = 'FINALIZED',
  "settledAt" = NOW(),
  "autoConfirmedReason" = 'Backfill: recipient is not a registered user'
WHERE status = 'PROPOSED'
  AND "toParticipantType" != 'user';
