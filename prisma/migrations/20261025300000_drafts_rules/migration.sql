-- Drafts and income rules (budget build plan P5, SPEC §5.10, §5.13).
-- Placeholder timestamp: the orchestrator assigns the final one at merge.
-- 1. budget_draft: Plan next month (PLAN) and What if (WHAT_IF). A draft is
--    never money: expected money in and pretend rows live only here and are
--    never written as expenses. One open draft per book, month and kind; one
--    saved plan (status APPLIED) per book and month, which Use my plan
--    starts from when that month's money arrives (owner r5 Q1). No free text
--    in the JSON columns: lines carry ids and amounts only (E2EE rule 10).
-- 2. income_rule: what each money in shares out (percent, fixed amount, the
--    rest) to an envelope. "matchTitle" is the one user-text match (TITLE
--    rules, the E2EE known exception) and lives in its own column.
--    "archivedAt": a removed rule keeps its row so history can name it.
-- 3. income_rule_run: one row per income row the rules processed, keyed on
--    the expense: the primary key makes each run exactly-once, also for rows
--    the Go sidecar posts (run lazily on the next read under the book lock).
--    No foreign key to expense on purpose: when the income is deleted the
--    run row stays, so the next read reverts that row's rule batch (S16).
--    "record" holds the rules the first run used (ids, order, envelope,
--    action; never a title) and the batch net, "fingerprint" the row as last
--    run, so an edit to the row writes a delta with the recorded rules.
-- RLS: book tables, members only. Additive and idempotent.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DraftKind') THEN
    CREATE TYPE "DraftKind" AS ENUM ('PLAN', 'WHAT_IF');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DraftStatus') THEN
    CREATE TYPE "DraftStatus" AS ENUM ('OPEN', 'APPLIED', 'DISCARDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IncomeRuleMatch') THEN
    CREATE TYPE "IncomeRuleMatch" AS ENUM ('ANY', 'CATEGORY', 'TEMPLATE', 'TITLE', 'CURRENCY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IncomeRuleAction') THEN
    CREATE TYPE "IncomeRuleAction" AS ENUM ('PERCENT', 'AMOUNT', 'REMAINDER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "budget_draft" (
  "id"             TEXT          NOT NULL,
  "bookId"         TEXT          NOT NULL,
  -- PLAN: next month; WHAT_IF: the current or next month.
  "month"          INTEGER       NOT NULL,
  "kind"           "DraftKind"   NOT NULL DEFAULT 'PLAN',
  "status"         "DraftStatus" NOT NULL DEFAULT 'OPEN',
  -- PLAN: [{ envelopeId, amountMinor }], each envelope's planned Assigned.
  "lines"          JSONB         NOT NULL DEFAULT '[]',
  -- WHAT_IF: [{ id, from, to, amountMinor }]; Apply writes only these.
  "moves"          JSONB         NOT NULL DEFAULT '[]',
  -- [{ id, templateId, categoryId, amountMinor }]: never written as money in.
  "expectedIn"     JSONB         NOT NULL DEFAULT '[]',
  -- WHAT_IF: [{ id, kind, categoryId, envelopeId, amountMinor }]: never written.
  "pretend"        JSONB         NOT NULL DEFAULT '[]',
  "appliedAt"      TIMESTAMP(3),
  -- The saved plan this one replaced; its undo puts that one back.
  "supersedesId"   TEXT,
  -- "Fund it now": the PLAN_APPLY batch, while it stands.
  "fundedBatchId"  TEXT,
  "createdById"    TEXT          NOT NULL,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "budget_draft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "budget_draft_bookId_month_status_idx" ON "budget_draft" ("bookId", "month", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "budget_draft_one_open" ON "budget_draft" ("bookId", "month", "kind") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS "budget_draft_one_saved_plan" ON "budget_draft" ("bookId", "month") WHERE "status" = 'APPLIED' AND "kind" = 'PLAN';

CREATE TABLE IF NOT EXISTS "income_rule" (
  "id"          TEXT               NOT NULL,
  "bookId"      TEXT               NOT NULL,
  "sortOrder"   INTEGER            NOT NULL,
  "name"        TEXT               NOT NULL,
  "matchKind"   "IncomeRuleMatch"  NOT NULL DEFAULT 'ANY',
  -- CATEGORY: category id; TEMPLATE: template id; CURRENCY: ISO code.
  "matchValue"  VARCHAR(64),
  -- TITLE: the text a title contains (user text, own column).
  "matchTitle"  TEXT,
  "action"      "IncomeRuleAction" NOT NULL,
  -- PERCENT: percent (20.0); AMOUNT: book currency; REMAINDER: null.
  "value"       DECIMAL(19,8),
  "envelopeId"  TEXT               NOT NULL,
  "active"      BOOLEAN            NOT NULL DEFAULT true,
  "archivedAt"  TIMESTAMP(3),
  -- Rules apply to income rows created after this.
  "createdAt"   TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)       NOT NULL,
  CONSTRAINT "income_rule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "income_rule_bookId_sortOrder_idx" ON "income_rule" ("bookId", "sortOrder");

CREATE TABLE IF NOT EXISTS "income_rule_run" (
  -- The income row (no foreign key: the run outlives a deleted row).
  "expenseId"   TEXT         NOT NULL,
  "bookId"      TEXT         NOT NULL,
  -- The row's latest RULE batch; null when no rule matched.
  "batchId"     TEXT,
  -- The person undid a batch: the row's rules never run again.
  "skipped"     BOOLEAN      NOT NULL DEFAULT false,
  -- rules.ts RecordedRun without match text.
  "record"      JSONB        NOT NULL,
  -- amount, currency, date and whether it is budget income, as last run.
  "fingerprint" VARCHAR(200) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "income_rule_run_pkey" PRIMARY KEY ("expenseId")
);

CREATE INDEX IF NOT EXISTS "income_rule_run_bookId_idx" ON "income_rule_run" ("bookId");

DO $$
DECLARE fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('budget_draft', 'budget_draft_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('income_rule', 'income_rule_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('income_rule', 'income_rule_envelopeId_bookId_fkey',
      'FOREIGN KEY ("envelopeId", "bookId") REFERENCES "envelope"("id", "bookId") ON DELETE NO ACTION ON UPDATE CASCADE'),
    ('income_rule_run', 'income_rule_run_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE')
  ) AS t(tbl, name, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tbl, fk.name, fk.def);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON "budget_draft" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE ON "income_rule" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE ON "income_rule_run" TO retrospend_app;
-- Drafts are discarded and rules archived, never deleted; a run is kept for good.
REVOKE DELETE ON "budget_draft" FROM retrospend_app;
REVOKE DELETE ON "income_rule" FROM retrospend_app;
REVOKE DELETE ON "income_rule_run" FROM retrospend_app;

ALTER TABLE "budget_draft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_rule_run" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_draft_access ON "budget_draft";
CREATE POLICY budget_draft_access ON "budget_draft"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS income_rule_access ON "income_rule";
CREATE POLICY income_rule_access ON "income_rule"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS income_rule_run_access ON "income_rule_run";
CREATE POLICY income_rule_run_access ON "income_rule_run"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));
