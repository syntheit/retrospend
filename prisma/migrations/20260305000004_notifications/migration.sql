-- Idempotent migration: in-app notification system
-- NotificationType enum

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationType') THEN
    CREATE TYPE "NotificationType" AS ENUM (
      'EXPENSE_SPLIT',
      'VERIFICATION_REQUEST',
      'EXPENSE_EDITED',
      'EXPENSE_DELETED',
      'SETTLEMENT_RECEIVED',
      'SETTLEMENT_CONFIRMED',
      'PERIOD_CLOSED',
      'PARTICIPANT_ADDED',
      'PAYMENT_REMINDER'
    );
  END IF;
END $$;

-- notification table

CREATE TABLE IF NOT EXISTS "notification" (
  "id"        TEXT        NOT NULL,
  "userId"    TEXT        NOT NULL,
  "type"      "NotificationType" NOT NULL,
  "title"     VARCHAR(200) NOT NULL,
  "body"      VARCHAR(500) NOT NULL,
  "data"      JSONB,
  "isRead"    BOOLEAN     NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_userId_fkey'
  ) THEN
    ALTER TABLE "notification"
      ADD CONSTRAINT "notification_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "notification_userId_isRead_createdAt_idx"
  ON "notification" ("userId", "isRead", "createdAt");

-- notification_preference table

CREATE TABLE IF NOT EXISTS "notification_preference" (
  "id"         TEXT        NOT NULL,
  "userId"     TEXT        NOT NULL,
  "type"       "NotificationType" NOT NULL,
  "inApp"      BOOLEAN     NOT NULL DEFAULT true,
  "email"      BOOLEAN     NOT NULL DEFAULT false,
  "digestMode" BOOLEAN     NOT NULL DEFAULT false,

  CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_preference_userId_fkey'
  ) THEN
    ALTER TABLE "notification_preference"
      ADD CONSTRAINT "notification_preference_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_preference_userId_type_key'
  ) THEN
    ALTER TABLE "notification_preference"
      ADD CONSTRAINT "notification_preference_userId_type_key"
      UNIQUE ("userId", "type");
  END IF;
END $$;

-- RLS for notification table
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification" TO retrospend_app;
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_user_policy" ON "notification";
CREATE POLICY "notification_user_policy" ON "notification"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

-- RLS for notification_preference table
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preference" TO retrospend_app;
ALTER TABLE "notification_preference" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_preference_user_policy" ON "notification_preference";
CREATE POLICY "notification_preference_user_policy" ON "notification_preference"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
