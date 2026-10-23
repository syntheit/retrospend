-- Splits in the envelope budget (M7, budget build plan P3). Placeholder
-- timestamp: the orchestrator assigns the final one at merge.
-- 1. split_participant."categoryId" and "categorySource" (D19): the
--    participant's own category for their share of someone else's split,
--    set by them (USER) or by the budget's smart default. Nullable, no
--    default: adding them rewrites nothing. A deleted category clears the
--    link (SET NULL) and the share falls back to "Everything else".
-- 2. project_participant."budgetRouting" and "budgetEnvelopeId" (D31, D11
--    revised): "Count my share in" by category (default), one envelope, or
--    not in the budget. Backfill, once, when the column is created: a
--    participant who hid the project from analytics gets NOT_IN_BUDGET, so
--    nobody's budget changes on deploy. excludeFromAnalytics stays a
--    reports flag. An envelope can only be named with ENVELOPE routing.
-- 3. settlement."forgiveEnvelopeId" (added by M3) now references the
--    envelope it charges (SET NULL: a forgive whose envelope was deleted is
--    charged to "Everything else").
-- RLS: no new table. The existing split_participant policy already lets a
-- participant update their own row; the services write only the
-- participant's own row and own category. project_participant keeps its
-- policy; the service writes only the caller's own participant row.
-- Additive and idempotent: every statement can run twice.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShareCategorySource') THEN
    CREATE TYPE "ShareCategorySource" AS ENUM ('USER', 'NAME_MATCH', 'PROJECT', 'PERSON', 'TITLE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProjectBudgetRouting') THEN
    CREATE TYPE "ProjectBudgetRouting" AS ENUM ('CATEGORY', 'ENVELOPE', 'NOT_IN_BUDGET');
  END IF;
END $$;

-- 1. The participant's own share category.
ALTER TABLE "split_participant" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "split_participant" ADD COLUMN IF NOT EXISTS "categorySource" "ShareCategorySource";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'split_participant_categoryId_fkey') THEN
    ALTER TABLE "split_participant"
      ADD CONSTRAINT "split_participant_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "split_participant_categoryId_idx" ON "split_participant" ("categoryId");

-- 2. Project budget routing, backfilled once from the analytics flag.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'project_participant'
      AND column_name = 'budgetRouting'
  ) THEN
    ALTER TABLE "project_participant"
      ADD COLUMN "budgetRouting" "ProjectBudgetRouting" NOT NULL DEFAULT 'CATEGORY';
    UPDATE "project_participant"
      SET "budgetRouting" = 'NOT_IN_BUDGET'
      WHERE "excludeFromAnalytics" = true;
  END IF;
END $$;

ALTER TABLE "project_participant" ADD COLUMN IF NOT EXISTS "budgetEnvelopeId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_participant_budgetEnvelopeId_fkey') THEN
    ALTER TABLE "project_participant"
      ADD CONSTRAINT "project_participant_budgetEnvelopeId_fkey"
      FOREIGN KEY ("budgetEnvelopeId") REFERENCES "envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_participant_budget_envelope_check') THEN
    ALTER TABLE "project_participant"
      ADD CONSTRAINT "project_participant_budget_envelope_check"
      CHECK ("budgetEnvelopeId" IS NULL OR "budgetRouting" = 'ENVELOPE');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "project_participant_budgetEnvelopeId_idx" ON "project_participant" ("budgetEnvelopeId");

-- 3. A forgive names the envelope it charges.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlement_forgiveEnvelopeId_fkey') THEN
    ALTER TABLE "settlement"
      ADD CONSTRAINT "settlement_forgiveEnvelopeId_fkey"
      FOREIGN KEY ("forgiveEnvelopeId") REFERENCES "envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "settlement_forgiveEnvelopeId_idx" ON "settlement" ("forgiveEnvelopeId");
