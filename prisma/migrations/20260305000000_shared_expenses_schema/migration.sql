-- ============================================================
-- Shared Expenses: enums
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ParticipantType') THEN
    CREATE TYPE "ParticipantType" AS ENUM ('user', 'guest', 'shadow');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SplitMode') THEN
    CREATE TYPE "SplitMode" AS ENUM ('EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VerificationStatus') THEN
    CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'AUTO_ACCEPTED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SettlementStatus') THEN
    CREATE TYPE "SettlementStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'FINALIZED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditAction') THEN
    CREATE TYPE "AuditAction" AS ENUM (
      'CREATED', 'EDITED', 'DELETED',
      'VERIFIED', 'REJECTED', 'AUTO_VERIFIED',
      'SETTLED', 'PERIOD_CLOSED',
      'PARTICIPANT_ADDED', 'PARTICIPANT_REMOVED',
      'ROLE_CHANGED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditTargetType') THEN
    CREATE TYPE "AuditTargetType" AS ENUM (
      'SHARED_TRANSACTION', 'SETTLEMENT',
      'PROJECT', 'BILLING_PERIOD',
      'SPLIT_PARTICIPANT'
    );
  END IF;
END $$;

-- ============================================================
-- ShadowProfile
-- ============================================================

CREATE TABLE IF NOT EXISTS "shadow_profile" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(64),
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shadow_profile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "shadow_profile_createdById_idx" ON "shadow_profile"("createdById");
CREATE INDEX IF NOT EXISTS "shadow_profile_email_idx" ON "shadow_profile"("email");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shadow_profile_createdById_fkey') THEN
    ALTER TABLE "shadow_profile"
      ADD CONSTRAINT "shadow_profile_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shadow_profile_claimedById_fkey') THEN
    ALTER TABLE "shadow_profile"
      ADD CONSTRAINT "shadow_profile_claimedById_fkey"
      FOREIGN KEY ("claimedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================
-- GuestSession
-- ============================================================

CREATE TABLE IF NOT EXISTS "guest_session" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "sessionToken" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "guest_session_sessionToken_key" ON "guest_session"("sessionToken");
CREATE INDEX IF NOT EXISTS "guest_session_email_idx" ON "guest_session"("email");

-- ============================================================
-- SharedTransaction
-- ============================================================

CREATE TABLE IF NOT EXISTS "shared_transaction" (
    "id" TEXT NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(19,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT,
    "splitMode" "SplitMode" NOT NULL DEFAULT 'EQUAL',
    "notes" TEXT,
    "receiptUrl" VARCHAR(2048),
    "isLocked" BOOLEAN NOT NULL DEFAULT false,

    -- Polymorphic payer reference
    "paidByType" "ParticipantType" NOT NULL,
    "paidById" TEXT NOT NULL,

    -- Polymorphic creator reference
    "createdByType" "ParticipantType" NOT NULL,
    "createdById" TEXT NOT NULL,

    -- Optional project/billing period (nullable for standalone splits)
    "projectId" TEXT,
    "billingPeriodId" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_transaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "shared_transaction_paidByType_paidById_idx" ON "shared_transaction"("paidByType", "paidById");
CREATE INDEX IF NOT EXISTS "shared_transaction_createdByType_createdById_idx" ON "shared_transaction"("createdByType", "createdById");
CREATE INDEX IF NOT EXISTS "shared_transaction_projectId_idx" ON "shared_transaction"("projectId");
CREATE INDEX IF NOT EXISTS "shared_transaction_billingPeriodId_idx" ON "shared_transaction"("billingPeriodId");
CREATE INDEX IF NOT EXISTS "shared_transaction_date_idx" ON "shared_transaction"("date");
CREATE INDEX IF NOT EXISTS "shared_transaction_categoryId_idx" ON "shared_transaction"("categoryId");

-- CHECK constraint for paidByType
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_transaction_paidByType_check') THEN
    ALTER TABLE "shared_transaction"
      ADD CONSTRAINT "shared_transaction_paidByType_check"
      CHECK ("paidByType" IN ('user', 'guest', 'shadow'));
  END IF;
END $$;

-- CHECK constraint for createdByType
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_transaction_createdByType_check') THEN
    ALTER TABLE "shared_transaction"
      ADD CONSTRAINT "shared_transaction_createdByType_check"
      CHECK ("createdByType" IN ('user', 'guest', 'shadow'));
  END IF;
END $$;

-- FK to category (optional)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_transaction_categoryId_fkey') THEN
    ALTER TABLE "shared_transaction"
      ADD CONSTRAINT "shared_transaction_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================
-- SplitParticipant
-- ============================================================

CREATE TABLE IF NOT EXISTS "split_participant" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,

    -- Polymorphic participant reference
    "participantType" "ParticipantType" NOT NULL,
    "participantId" TEXT NOT NULL,

    "shareAmount" DECIMAL(19,8) NOT NULL,
    "sharePercentage" DECIMAL(5,2),
    "shareUnits" INTEGER,

    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(500),

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "split_participant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "split_participant_transactionId_idx" ON "split_participant"("transactionId");
CREATE INDEX IF NOT EXISTS "split_participant_participantType_participantId_idx" ON "split_participant"("participantType", "participantId");
CREATE INDEX IF NOT EXISTS "split_participant_verificationStatus_idx" ON "split_participant"("verificationStatus");

-- Unique: one participant per transaction
CREATE UNIQUE INDEX IF NOT EXISTS "split_participant_transactionId_participantType_participantId_key"
  ON "split_participant"("transactionId", "participantType", "participantId");

-- CHECK constraint for participantType
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'split_participant_participantType_check') THEN
    ALTER TABLE "split_participant"
      ADD CONSTRAINT "split_participant_participantType_check"
      CHECK ("participantType" IN ('user', 'guest', 'shadow'));
  END IF;
END $$;

-- FK to shared_transaction
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'split_participant_transactionId_fkey') THEN
    ALTER TABLE "split_participant"
      ADD CONSTRAINT "split_participant_transactionId_fkey"
      FOREIGN KEY ("transactionId") REFERENCES "shared_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================
-- Settlement
-- ============================================================

CREATE TABLE IF NOT EXISTS "settlement" (
    "id" TEXT NOT NULL,

    -- Polymorphic from/to participant refs
    "fromParticipantType" "ParticipantType" NOT NULL,
    "fromParticipantId" TEXT NOT NULL,
    "toParticipantType" "ParticipantType" NOT NULL,
    "toParticipantId" TEXT NOT NULL,

    "amount" DECIMAL(19,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "convertedAmount" DECIMAL(19,8),
    "convertedCurrency" TEXT,
    "exchangeRateUsed" DECIMAL(18,6),
    "paymentMethod" VARCHAR(191),

    "billingPeriodId" TEXT,

    "status" "SettlementStatus" NOT NULL DEFAULT 'PROPOSED',
    "confirmedByPayer" BOOLEAN NOT NULL DEFAULT false,
    "confirmedByPayee" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),

    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "settlement_fromParticipantType_fromParticipantId_idx"
  ON "settlement"("fromParticipantType", "fromParticipantId");
CREATE INDEX IF NOT EXISTS "settlement_toParticipantType_toParticipantId_idx"
  ON "settlement"("toParticipantType", "toParticipantId");
CREATE INDEX IF NOT EXISTS "settlement_billingPeriodId_idx" ON "settlement"("billingPeriodId");
CREATE INDEX IF NOT EXISTS "settlement_status_idx" ON "settlement"("status");

-- CHECK constraints for participant types
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlement_fromParticipantType_check') THEN
    ALTER TABLE "settlement"
      ADD CONSTRAINT "settlement_fromParticipantType_check"
      CHECK ("fromParticipantType" IN ('user', 'guest', 'shadow'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlement_toParticipantType_check') THEN
    ALTER TABLE "settlement"
      ADD CONSTRAINT "settlement_toParticipantType_check"
      CHECK ("toParticipantType" IN ('user', 'guest', 'shadow'));
  END IF;
END $$;

-- ============================================================
-- AuditLogEntry (append-only)
-- ============================================================

CREATE TABLE IF NOT EXISTS "audit_log_entry" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Polymorphic actor reference (who performed the action)
    "actorType" "ParticipantType" NOT NULL,
    "actorId" TEXT NOT NULL,

    "action" "AuditAction" NOT NULL,
    "targetType" "AuditTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,

    "changes" JSONB,
    "context" JSONB,

    "projectId" TEXT,

    CONSTRAINT "audit_log_entry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_log_entry_targetType_targetId_idx" ON "audit_log_entry"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "audit_log_entry_actorType_actorId_idx" ON "audit_log_entry"("actorType", "actorId");
CREATE INDEX IF NOT EXISTS "audit_log_entry_projectId_idx" ON "audit_log_entry"("projectId");
CREATE INDEX IF NOT EXISTS "audit_log_entry_timestamp_idx" ON "audit_log_entry"("timestamp");
CREATE INDEX IF NOT EXISTS "audit_log_entry_action_idx" ON "audit_log_entry"("action");

-- CHECK constraint for actorType
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_entry_actorType_check') THEN
    ALTER TABLE "audit_log_entry"
      ADD CONSTRAINT "audit_log_entry_actorType_check"
      CHECK ("actorType" IN ('user', 'guest', 'shadow'));
  END IF;
END $$;

-- ============================================================
-- RLS policies
-- ============================================================

-- shadow_profile: owned by createdById
ALTER TABLE "shadow_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shadow_profile" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shadow_profile_isolation" ON "shadow_profile";
CREATE POLICY "shadow_profile_isolation" ON "shadow_profile"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING ("createdById" = current_setting('app.current_user_id', true))
    WITH CHECK ("createdById" = current_setting('app.current_user_id', true));

-- shared_transaction: accessible if user is the payer OR a split participant
-- For now, use a permissive policy that allows access if user is the creator.
-- More nuanced multi-party access will be handled at the application layer.
ALTER TABLE "shared_transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shared_transaction" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared_transaction_payer_access" ON "shared_transaction";
CREATE POLICY "shared_transaction_payer_access" ON "shared_transaction"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("paidByType" = 'user' AND "paidById" = current_setting('app.current_user_id', true))
      OR ("createdByType" = 'user' AND "createdById" = current_setting('app.current_user_id', true))
      OR EXISTS (
        SELECT 1 FROM "split_participant" sp
        WHERE sp."transactionId" = "shared_transaction"."id"
          AND sp."participantType" = 'user'
          AND sp."participantId" = current_setting('app.current_user_id', true)
      )
    )
    WITH CHECK (
      ("paidByType" = 'user' AND "paidById" = current_setting('app.current_user_id', true))
      OR ("createdByType" = 'user' AND "createdById" = current_setting('app.current_user_id', true))
    );

-- split_participant: accessible if user is the participant OR owns the transaction
ALTER TABLE "split_participant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "split_participant" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "split_participant_access" ON "split_participant";
CREATE POLICY "split_participant_access" ON "split_participant"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
      OR EXISTS (
        SELECT 1 FROM "shared_transaction" st
        WHERE st."id" = "split_participant"."transactionId"
          AND (
            (st."paidByType" = 'user' AND st."paidById" = current_setting('app.current_user_id', true))
            OR (st."createdByType" = 'user' AND st."createdById" = current_setting('app.current_user_id', true))
          )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM "shared_transaction" st
        WHERE st."id" = "split_participant"."transactionId"
          AND (
            (st."paidByType" = 'user' AND st."paidById" = current_setting('app.current_user_id', true))
            OR (st."createdByType" = 'user' AND st."createdById" = current_setting('app.current_user_id', true))
          )
      )
    );

-- settlement: accessible if user is from or to participant
ALTER TABLE "settlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settlement_access" ON "settlement";
CREATE POLICY "settlement_access" ON "settlement"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
      OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
      OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
    );

-- audit_log_entry: read access if user is the actor or involved in the target
-- Write access is unrestricted for the app (append-only enforced at application layer)
ALTER TABLE "audit_log_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log_entry" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_entry_read" ON "audit_log_entry";
CREATE POLICY "audit_log_entry_read" ON "audit_log_entry"
    AS PERMISSIVE FOR SELECT TO retrospend_app
    USING (
      ("actorType" = 'user' AND "actorId" = current_setting('app.current_user_id', true))
      OR EXISTS (
        SELECT 1 FROM "shared_transaction" st
        WHERE "audit_log_entry"."targetType" = 'SHARED_TRANSACTION'
          AND st."id" = "audit_log_entry"."targetId"
          AND (
            (st."paidByType" = 'user' AND st."paidById" = current_setting('app.current_user_id', true))
            OR (st."createdByType" = 'user' AND st."createdById" = current_setting('app.current_user_id', true))
            OR EXISTS (
              SELECT 1 FROM "split_participant" sp
              WHERE sp."transactionId" = st."id"
                AND sp."participantType" = 'user'
                AND sp."participantId" = current_setting('app.current_user_id', true)
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM "settlement" s
        WHERE "audit_log_entry"."targetType" = 'SETTLEMENT'
          AND s."id" = "audit_log_entry"."targetId"
          AND (
            (s."fromParticipantType" = 'user' AND s."fromParticipantId" = current_setting('app.current_user_id', true))
            OR (s."toParticipantType" = 'user' AND s."toParticipantId" = current_setting('app.current_user_id', true))
          )
      )
    );

DROP POLICY IF EXISTS "audit_log_entry_insert" ON "audit_log_entry";
CREATE POLICY "audit_log_entry_insert" ON "audit_log_entry"
    AS PERMISSIVE FOR INSERT TO retrospend_app
    WITH CHECK (true);

-- guest_session: no RLS (managed by application layer, guests don't use set_config)
ALTER TABLE "guest_session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_session" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guest_session_app_access" ON "guest_session";
CREATE POLICY "guest_session_app_access" ON "guest_session"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- Grant permissions to app role
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON "shadow_profile" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "guest_session" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "shared_transaction" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "split_participant" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "settlement" TO retrospend_app;
GRANT SELECT, INSERT ON "audit_log_entry" TO retrospend_app;
