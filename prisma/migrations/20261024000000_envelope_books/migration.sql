-- Envelope books (M6, budget build plan P2). Placeholder timestamp: the
-- orchestrator assigns the final one at merge.
-- 1. Budget enums. MovementKind and the target enums carry every value the
--    later phases use, so P3 to P6 never alter a type in place.
-- 2. app_settings."envelopeBudgetMode" (OFF default), the rollout flag for
--    the new budget page and the envelope procedures. It reuses the
--    FeatureFlagMode type from ui_flags (M13).
-- 3. budget_book, book_period, budget_member, envelope_group (role and target
--    columns), envelope (every target and leftover column, targetStartMonth),
--    envelope_category, budget_movement. Every table is new, so nothing is
--    backfilled and no existing table is rewritten.
-- 4. Integrity in the database, not only in services:
--    - one personal book per user (partial unique index);
--    - a link and a movement can only name envelopes of their own book
--      (composite foreign keys on (id, bookId));
--    - budget_movement: amount > 0, at least one side, never the same side
--      twice. Movements are append-only: retrospend_app may insert and read
--      them, never update or delete (undo appends a mirror row, D28).
--    Envelope references from movements and the default envelope use NO
--    ACTION, checked at the end of the statement, so deleting a whole book
--    (user deletion cascades) works while deleting a referenced envelope on
--    its own fails: envelopes with history are archived, never deleted.
-- 5. RLS: two SECURITY DEFINER helpers read budget_member without RLS, so
--    the member policy can call them without recursing (pattern of
--    20260305000005_fix_rls_recursion). Every book table is visible to the
--    book's members. A user creates only their own book and only its owner
--    adds members. Grants and policies are written here (no FORCE, per
--    20260311000000).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BudgetStyle') THEN
    CREATE TYPE "BudgetStyle" AS ENUM ('LIMITS', 'FLEX', 'EVERY_DOLLAR', 'SAVE_FIRST', 'FIFTY_THIRTY_TWENTY', 'WEEKLY', 'DEBT_PAYOFF');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingSource') THEN
    CREATE TYPE "FundingSource" AS ENUM ('INCOME', 'TARGETS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EnvelopeKind') THEN
    CREATE TYPE "EnvelopeKind" AS ENUM ('MONTHLY', 'BILL', 'SAVINGS', 'NONE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TargetMode') THEN
    CREATE TYPE "TargetMode" AS ENUM ('REFILL', 'SET_ASIDE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TargetCadence') THEN
    CREATE TYPE "TargetCadence" AS ENUM ('MONTH', 'WEEK');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeftoverRule') THEN
    CREATE TYPE "LeftoverRule" AS ENUM ('CARRY', 'RETURN', 'SWEEP');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GroupTargetKind') THEN
    CREATE TYPE "GroupTargetKind" AS ENUM ('NONE', 'AMOUNT', 'PERCENT_OF_INCOME');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GroupRole') THEN
    CREATE TYPE "GroupRole" AS ENUM ('BILLS', 'SPENDING', 'SAVINGS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BudgetMemberRole') THEN
    CREATE TYPE "BudgetMemberRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MovementKind') THEN
    CREATE TYPE "MovementKind" AS ENUM ('ASSIGN', 'SET', 'MOVE', 'COVER', 'UNASSIGN', 'AUTO_FILL', 'RULE', 'PLAN_FUND', 'PLAN_APPLY', 'CARRY_OVERSPEND', 'FIX_NEGATIVE', 'RESET', 'ARCHIVE', 'MIGRATION', 'UNDO');
  END IF;
END $$;

ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "envelopeBudgetMode" "FeatureFlagMode" NOT NULL DEFAULT 'OFF';

CREATE TABLE IF NOT EXISTS "budget_book" (
  "id"                       TEXT            NOT NULL,
  "name"                     VARCHAR(64)     NOT NULL DEFAULT 'Personal',
  "isPersonal"               BOOLEAN         NOT NULL DEFAULT true,
  "currency"                 TEXT            NOT NULL,
  "style"                    "BudgetStyle"   NOT NULL DEFAULT 'FLEX',
  "fundingSource"            "FundingSource" NOT NULL DEFAULT 'INCOME',
  "pausedAt"                 TIMESTAMP(3),
  "weekStartDay"             INTEGER         NOT NULL DEFAULT 1,
  "monthStartDay"            INTEGER         NOT NULL DEFAULT 1,
  "dirtyFromMonth"           INTEGER,
  "timeZone"                 VARCHAR(64)     NOT NULL DEFAULT 'UTC',
  "timeZoneConfirmed"        BOOLEAN         NOT NULL DEFAULT false,
  "startDate"                TIMESTAMP(3)    NOT NULL,
  "startMonth"               INTEGER         NOT NULL,
  "defaultEnvelopeId"        TEXT,
  "startingBalanceExpenseId" TEXT,
  "startingMoneyConfirmedAt" TIMESTAMP(3),
  "legacyMigrationRunId"     VARCHAR(64),
  "legacyMigratedAt"         TIMESTAMP(3),
  "createdById"              TEXT            NOT NULL,
  "createdAt"                TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "budget_book_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_book_week_start_day_check" CHECK ("weekStartDay" BETWEEN 0 AND 6),
  CONSTRAINT "budget_book_month_start_day_check" CHECK ("monthStartDay" BETWEEN 1 AND 28),
  CONSTRAINT "budget_book_start_month_check" CHECK ("startMonth" % 100 BETWEEN 1 AND 12)
);

CREATE TABLE IF NOT EXISTS "book_period" (
  "id"        TEXT         NOT NULL,
  "bookId"    TEXT         NOT NULL,
  "fromMonth" INTEGER      NOT NULL,
  "startDay"  INTEGER      NOT NULL,
  "rateType"  VARCHAR(32)  NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "book_period_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "book_period_start_day_check" CHECK ("startDay" BETWEEN 1 AND 28),
  CONSTRAINT "book_period_from_month_check" CHECK ("fromMonth" % 100 BETWEEN 1 AND 12)
);

CREATE TABLE IF NOT EXISTS "budget_member" (
  "id"        TEXT               NOT NULL,
  "bookId"    TEXT               NOT NULL,
  "userId"    TEXT               NOT NULL,
  "role"      "BudgetMemberRole" NOT NULL DEFAULT 'OWNER',
  "createdAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budget_member_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "envelope_group" (
  "id"             TEXT              NOT NULL,
  "bookId"         TEXT              NOT NULL,
  "name"           VARCHAR(64)       NOT NULL,
  "sortOrder"      INTEGER           NOT NULL,
  "role"           "GroupRole",
  "targetKind"     "GroupTargetKind" NOT NULL DEFAULT 'NONE',
  "targetValue"    DECIMAL(19,8),
  "mainEnvelopeId" TEXT,
  "archivedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "envelope_group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "envelope" (
  "id"                  TEXT                 NOT NULL,
  "bookId"              TEXT                 NOT NULL,
  "groupId"             TEXT,
  "name"                VARCHAR(64)          NOT NULL,
  "icon"                VARCHAR(32),
  "color"               "CategoryColor",
  "kind"                "EnvelopeKind"       NOT NULL DEFAULT 'MONTHLY',
  "sortOrder"           INTEGER              NOT NULL,
  "targetAmount"        DECIMAL(19,8),
  "targetMode"          "TargetMode"         NOT NULL DEFAULT 'REFILL',
  "targetCadence"       "TargetCadence"      NOT NULL DEFAULT 'MONTH',
  "targetMonthlyAmount" DECIMAL(19,8),
  "targetCurrency"      TEXT,
  "targetDueDate"       DATE,
  "targetRepeat"        "RecurringFrequency",
  "targetStartMonth"    INTEGER,
  "targetTemplateId"    TEXT,
  "targetLiabilityId"   TEXT,
  "leftoverRule"        "LeftoverRule"       NOT NULL DEFAULT 'CARRY',
  "leftoverSweepToId"   TEXT,
  "wealthAccountId"     TEXT,
  "wealthDedicated"     BOOLEAN              NOT NULL DEFAULT false,
  "archivedAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)         NOT NULL,
  CONSTRAINT "envelope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "envelope_target_amount_check" CHECK ("targetAmount" IS NULL OR "targetAmount" >= 0),
  CONSTRAINT "envelope_target_monthly_check" CHECK ("targetMonthlyAmount" IS NULL OR "targetMonthlyAmount" >= 0),
  CONSTRAINT "envelope_sweep_check" CHECK (("leftoverRule" = 'SWEEP') = ("leftoverSweepToId" IS NOT NULL) AND "leftoverSweepToId" IS DISTINCT FROM "id")
);

CREATE TABLE IF NOT EXISTS "envelope_category" (
  "id"         TEXT         NOT NULL,
  "bookId"     TEXT         NOT NULL,
  "envelopeId" TEXT         NOT NULL,
  "categoryId" TEXT         NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "envelope_category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "budget_movement" (
  "id"              TEXT           NOT NULL,
  "bookId"          TEXT           NOT NULL,
  "month"           INTEGER        NOT NULL,
  "fromEnvelopeId"  TEXT,
  "toEnvelopeId"    TEXT,
  "amount"          DECIMAL(19,8)  NOT NULL,
  "kind"            "MovementKind" NOT NULL,
  "batchId"         TEXT,
  "revertsId"       TEXT,
  "sourceExpenseId" TEXT,
  "ruleId"          TEXT,
  "note"            VARCHAR(200),
  "actorUserId"     TEXT           NOT NULL,
  "createdAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budget_movement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_movement_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "budget_movement_side_check" CHECK ("fromEnvelopeId" IS NOT NULL OR "toEnvelopeId" IS NOT NULL),
  CONSTRAINT "budget_movement_distinct_check" CHECK ("fromEnvelopeId" IS DISTINCT FROM "toEnvelopeId"),
  CONSTRAINT "budget_movement_month_check" CHECK ("month" % 100 BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX IF NOT EXISTS "budget_book_defaultEnvelopeId_key" ON "budget_book" ("defaultEnvelopeId");
CREATE UNIQUE INDEX IF NOT EXISTS "budget_book_startingBalanceExpenseId_key" ON "budget_book" ("startingBalanceExpenseId");
CREATE INDEX IF NOT EXISTS "budget_book_createdById_idx" ON "budget_book" ("createdById");
-- One personal book per user; a lazy and a batch migration racing turn into a skip.
CREATE UNIQUE INDEX IF NOT EXISTS "budget_book_personal_key" ON "budget_book" ("createdById") WHERE "isPersonal";
CREATE UNIQUE INDEX IF NOT EXISTS "book_period_bookId_fromMonth_key" ON "book_period" ("bookId", "fromMonth");
CREATE UNIQUE INDEX IF NOT EXISTS "budget_member_bookId_userId_key" ON "budget_member" ("bookId", "userId");
CREATE INDEX IF NOT EXISTS "budget_member_userId_idx" ON "budget_member" ("userId");
CREATE INDEX IF NOT EXISTS "envelope_group_bookId_sortOrder_idx" ON "envelope_group" ("bookId", "sortOrder");
CREATE INDEX IF NOT EXISTS "envelope_bookId_archivedAt_idx" ON "envelope" ("bookId", "archivedAt");
CREATE INDEX IF NOT EXISTS "envelope_groupId_idx" ON "envelope" ("groupId");
-- Target of the composite foreign keys below.
CREATE UNIQUE INDEX IF NOT EXISTS "envelope_id_bookId_key" ON "envelope" ("id", "bookId");
CREATE UNIQUE INDEX IF NOT EXISTS "envelope_category_bookId_categoryId_key" ON "envelope_category" ("bookId", "categoryId");
CREATE INDEX IF NOT EXISTS "envelope_category_envelopeId_idx" ON "envelope_category" ("envelopeId");
CREATE UNIQUE INDEX IF NOT EXISTS "budget_movement_revertsId_key" ON "budget_movement" ("revertsId");
CREATE INDEX IF NOT EXISTS "budget_movement_bookId_month_idx" ON "budget_movement" ("bookId", "month");
CREATE INDEX IF NOT EXISTS "budget_movement_bookId_createdAt_idx" ON "budget_movement" ("bookId", "createdAt");
CREATE INDEX IF NOT EXISTS "budget_movement_batchId_idx" ON "budget_movement" ("batchId");

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('budget_book', 'budget_book_createdById_fkey',
      'FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('budget_book', 'budget_book_defaultEnvelopeId_fkey',
      'FOREIGN KEY ("defaultEnvelopeId", "id") REFERENCES "envelope"("id", "bookId") ON DELETE NO ACTION ON UPDATE CASCADE'),
    ('budget_book', 'budget_book_startingBalanceExpenseId_fkey',
      'FOREIGN KEY ("startingBalanceExpenseId") REFERENCES "expense"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('book_period', 'book_period_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('budget_member', 'budget_member_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('budget_member', 'budget_member_userId_fkey',
      'FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('envelope_group', 'envelope_group_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('envelope_group', 'envelope_group_mainEnvelopeId_fkey',
      'FOREIGN KEY ("mainEnvelopeId") REFERENCES "envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('envelope', 'envelope_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('envelope', 'envelope_groupId_fkey',
      'FOREIGN KEY ("groupId") REFERENCES "envelope_group"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('envelope', 'envelope_targetTemplateId_fkey',
      'FOREIGN KEY ("targetTemplateId") REFERENCES "recurring_template"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('envelope', 'envelope_targetLiabilityId_fkey',
      'FOREIGN KEY ("targetLiabilityId") REFERENCES "asset_account"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('envelope', 'envelope_wealthAccountId_fkey',
      'FOREIGN KEY ("wealthAccountId") REFERENCES "asset_account"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('envelope', 'envelope_leftoverSweepToId_fkey',
      'FOREIGN KEY ("leftoverSweepToId", "bookId") REFERENCES "envelope"("id", "bookId") ON DELETE NO ACTION ON UPDATE CASCADE'),
    ('envelope_category', 'envelope_category_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('envelope_category', 'envelope_category_envelopeId_fkey',
      'FOREIGN KEY ("envelopeId", "bookId") REFERENCES "envelope"("id", "bookId") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('envelope_category', 'envelope_category_categoryId_fkey',
      'FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('budget_movement', 'budget_movement_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('budget_movement', 'budget_movement_fromEnvelopeId_fkey',
      'FOREIGN KEY ("fromEnvelopeId", "bookId") REFERENCES "envelope"("id", "bookId") ON DELETE NO ACTION ON UPDATE CASCADE'),
    ('budget_movement', 'budget_movement_toEnvelopeId_fkey',
      'FOREIGN KEY ("toEnvelopeId", "bookId") REFERENCES "envelope"("id", "bookId") ON DELETE NO ACTION ON UPDATE CASCADE'),
    ('budget_movement', 'budget_movement_revertsId_fkey',
      'FOREIGN KEY ("revertsId") REFERENCES "budget_movement"("id") ON DELETE NO ACTION ON UPDATE CASCADE'),
    ('budget_movement', 'budget_movement_sourceExpenseId_fkey',
      'FOREIGN KEY ("sourceExpenseId") REFERENCES "expense"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(tbl, name, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tbl, fk.name, fk.def);
    END IF;
  END LOOP;
END $$;

-- Is p_user_id a member of the book? SECURITY DEFINER reads budget_member
-- without RLS, so budget_member's own policy can call it without recursing.
CREATE OR REPLACE FUNCTION is_budget_member(p_book_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "budget_member" m
    WHERE m."bookId" = p_book_id AND m."userId" = p_user_id
  )
$$;

-- May p_user_id add or change members? The book's creator (needed for the
-- first member row, written at setup) or an OWNER member.
CREATE OR REPLACE FUNCTION is_budget_owner(p_book_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "budget_book" b
    WHERE b."id" = p_book_id AND b."createdById" = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM "budget_member" m
    WHERE m."bookId" = p_book_id AND m."userId" = p_user_id AND m."role" = 'OWNER'
  )
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "budget_book" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "book_period" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "budget_member" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "envelope_group" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "envelope" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "envelope_category" TO retrospend_app;
-- Append-only ledger: default privileges would hand out UPDATE and DELETE.
GRANT SELECT, INSERT ON "budget_movement" TO retrospend_app;
REVOKE UPDATE, DELETE ON "budget_movement" FROM retrospend_app;

ALTER TABLE "budget_book" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "book_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "envelope_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "envelope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "envelope_category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget_movement" ENABLE ROW LEVEL SECURITY;

-- The creator sees their book before the member row exists (INSERT ... RETURNING at setup).
DROP POLICY IF EXISTS budget_book_access ON "budget_book";
CREATE POLICY budget_book_access ON "budget_book"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("createdById" = current_setting('app.current_user_id', TRUE)
         OR is_budget_member("id", current_setting('app.current_user_id', TRUE)))
  WITH CHECK ("createdById" = current_setting('app.current_user_id', TRUE)
              OR is_budget_member("id", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS budget_member_access ON "budget_member";
CREATE POLICY budget_member_access ON "budget_member"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE)
         OR is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_owner("bookId", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS book_period_access ON "book_period";
CREATE POLICY book_period_access ON "book_period"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS envelope_group_access ON "envelope_group";
CREATE POLICY envelope_group_access ON "envelope_group"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS envelope_access ON "envelope";
CREATE POLICY envelope_access ON "envelope"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS envelope_category_access ON "envelope_category";
CREATE POLICY envelope_category_access ON "envelope_category"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS budget_movement_access ON "budget_movement";
CREATE POLICY budget_movement_access ON "budget_movement"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE))
              AND "actorUserId" = current_setting('app.current_user_id', TRUE));
