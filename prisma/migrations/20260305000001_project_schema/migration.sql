-- ============================================================
-- Project schema: enums, tables, FKs, RLS
-- ============================================================

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProjectType') THEN
    CREATE TYPE "ProjectType" AS ENUM ('TRIP', 'ONGOING', 'SOLO', 'ONE_TIME', 'GENERAL');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProjectStatus') THEN
    CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'SETTLED', 'ARCHIVED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProjectVisibility') THEN
    CREATE TYPE "ProjectVisibility" AS ENUM ('PRIVATE', 'LINK_ACCESSIBLE', 'PUBLIC');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProjectRole') THEN
    CREATE TYPE "ProjectRole" AS ENUM ('ORGANIZER', 'EDITOR', 'CONTRIBUTOR', 'VIEWER');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingCycleLength') THEN
    CREATE TYPE "BillingCycleLength" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingPeriodStatus') THEN
    CREATE TYPE "BillingPeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'SETTLED', 'ARCHIVED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingClosePermission') THEN
    CREATE TYPE "BillingClosePermission" AS ENUM ('ORGANIZER_ONLY', 'ANY_PARTICIPANT');
  END IF;
END $$;

-- ------------------------------------------------------------
-- project
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "project" (
    "id"                       TEXT NOT NULL,
    "name"                     VARCHAR(191) NOT NULL,
    "description"              VARCHAR(500),
    "type"                     "ProjectType" NOT NULL,
    "budgetAmount"             DECIMAL(19,8),
    "budgetCurrency"           TEXT,
    "primaryCurrency"          TEXT NOT NULL DEFAULT 'USD',
    "createdById"              TEXT NOT NULL,
    "visibility"               "ProjectVisibility" NOT NULL DEFAULT 'PRIVATE',
    "startDate"                TIMESTAMP(3),
    "endDate"                  TIMESTAMP(3),
    "status"                   "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingCycleLength"       "BillingCycleLength",
    "billingCycleDays"         INTEGER,
    "billingAutoClose"         BOOLEAN NOT NULL DEFAULT false,
    "billingCloseReminderDays" INTEGER NOT NULL DEFAULT 3,
    "billingClosePermission"   "BillingClosePermission" NOT NULL DEFAULT 'ORGANIZER_ONLY',
    "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "project_createdById_idx" ON "project"("createdById");
CREATE INDEX IF NOT EXISTS "project_status_idx" ON "project"("status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_createdById_fkey') THEN
    ALTER TABLE "project"
      ADD CONSTRAINT "project_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------
-- project_participant
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "project_participant" (
    "id"              TEXT NOT NULL,
    "projectId"       TEXT NOT NULL,
    "participantType" "ParticipantType" NOT NULL,
    "participantId"   TEXT NOT NULL,
    "role"            "ProjectRole" NOT NULL DEFAULT 'CONTRIBUTOR',
    "joinedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_participant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_participant_projectId_participantType_participantId_key"
  ON "project_participant"("projectId", "participantType", "participantId");

CREATE INDEX IF NOT EXISTS "project_participant_projectId_idx" ON "project_participant"("projectId");
CREATE INDEX IF NOT EXISTS "project_participant_participantType_participantId_idx"
  ON "project_participant"("participantType", "participantId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_participant_projectId_fkey') THEN
    ALTER TABLE "project_participant"
      ADD CONSTRAINT "project_participant_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------
-- billing_period
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "billing_period" (
    "id"         TEXT NOT NULL,
    "projectId"  TEXT NOT NULL,
    "label"      VARCHAR(100) NOT NULL,
    "startDate"  TIMESTAMP(3) NOT NULL,
    "endDate"    TIMESTAMP(3) NOT NULL,
    "status"     "BillingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedById" TEXT,
    "closedAt"   TIMESTAMP(3),
    "settledAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_period_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "billing_period_projectId_idx" ON "billing_period"("projectId");
CREATE INDEX IF NOT EXISTS "billing_period_status_idx" ON "billing_period"("status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_period_projectId_fkey') THEN
    ALTER TABLE "billing_period"
      ADD CONSTRAINT "billing_period_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------
-- magic_link
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "magic_link" (
    "id"          TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "roleGranted" "ProjectRole" NOT NULL DEFAULT 'CONTRIBUTOR',
    "createdById" TEXT NOT NULL,
    "expiresAt"   TIMESTAMP(3),
    "maxUses"     INTEGER,
    "useCount"    INTEGER NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "magic_link_projectId_idx" ON "magic_link"("projectId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'magic_link_projectId_fkey') THEN
    ALTER TABLE "magic_link"
      ADD CONSTRAINT "magic_link_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------
-- FKs from shared_transaction to project and billing_period
-- ------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_transaction_projectId_fkey') THEN
    ALTER TABLE "shared_transaction"
      ADD CONSTRAINT "shared_transaction_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_transaction_billingPeriodId_fkey') THEN
    ALTER TABLE "shared_transaction"
      ADD CONSTRAINT "shared_transaction_billingPeriodId_fkey"
      FOREIGN KEY ("billingPeriodId") REFERENCES "billing_period"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

-- project_participant: fully permissive reads so project policy can
-- reference it without recursion. App-layer enforces permissions.
ALTER TABLE "project_participant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_participant" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_participant_access" ON "project_participant";
CREATE POLICY "project_participant_access" ON "project_participant"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (true)
    WITH CHECK (true);

-- project: visible to creator or any participant (project_participant is
-- permissive so this subquery is safe from recursion).
ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_access" ON "project";
CREATE POLICY "project_access" ON "project"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      "createdById" = current_setting('app.current_user_id', true)
      OR EXISTS (
        SELECT 1 FROM "project_participant" pp
        WHERE pp."projectId" = "project"."id"
          AND pp."participantType" = 'user'
          AND pp."participantId" = current_setting('app.current_user_id', true)
      )
    )
    WITH CHECK (
      "createdById" = current_setting('app.current_user_id', true)
      OR EXISTS (
        SELECT 1 FROM "project_participant" pp
        WHERE pp."projectId" = "project"."id"
          AND pp."participantType" = 'user'
          AND pp."participantId" = current_setting('app.current_user_id', true)
      )
    );

-- billing_period: visible to project participants
ALTER TABLE "billing_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_period" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_period_access" ON "billing_period";
CREATE POLICY "billing_period_access" ON "billing_period"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      EXISTS (
        SELECT 1 FROM "project_participant" pp
        WHERE pp."projectId" = "billing_period"."projectId"
          AND pp."participantType" = 'user'
          AND pp."participantId" = current_setting('app.current_user_id', true)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM "project_participant" pp
        WHERE pp."projectId" = "billing_period"."projectId"
          AND pp."participantType" = 'user'
          AND pp."participantId" = current_setting('app.current_user_id', true)
      )
    );

-- magic_link: visible to project participants
ALTER TABLE "magic_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "magic_link" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "magic_link_access" ON "magic_link";
CREATE POLICY "magic_link_access" ON "magic_link"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      EXISTS (
        SELECT 1 FROM "project_participant" pp
        WHERE pp."projectId" = "magic_link"."projectId"
          AND pp."participantType" = 'user'
          AND pp."participantId" = current_setting('app.current_user_id', true)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM "project_participant" pp
        WHERE pp."projectId" = "magic_link"."projectId"
          AND pp."participantType" = 'user'
          AND pp."participantId" = current_setting('app.current_user_id', true)
      )
    );

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "project"             TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_participant" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "billing_period"      TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "magic_link"          TO retrospend_app;
