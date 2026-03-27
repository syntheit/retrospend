-- Pending email change fields on user table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pendingEmail" VARCHAR(255);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pendingEmailToken" VARCHAR(255);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pendingEmailExpiresAt" TIMESTAMPTZ;

-- Unique index on pendingEmailToken for fast token lookup
CREATE UNIQUE INDEX IF NOT EXISTS "user_pendingEmailToken_key" ON "user"("pendingEmailToken");

-- New event types for email change audit trail
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EMAIL_CHANGE_REQUESTED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EventType')) THEN
    ALTER TYPE "EventType" ADD VALUE 'EMAIL_CHANGE_REQUESTED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EMAIL_CHANGE_CONFIRMED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EventType')) THEN
    ALTER TYPE "EventType" ADD VALUE 'EMAIL_CHANGE_CONFIRMED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EMAIL_CHANGE_REVERTED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EventType')) THEN
    ALTER TYPE "EventType" ADD VALUE 'EMAIL_CHANGE_REVERTED';
  END IF;
END $$;
