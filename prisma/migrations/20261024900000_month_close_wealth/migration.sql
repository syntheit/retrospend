-- Month close and Wealth transfers (M8, budget build plan P4). Placeholder
-- timestamp: the orchestrator assigns the final one at merge.
-- 1. month_close: one row per closed budget month of a book (SPEC §5.5).
--    The summary (JSON, zod monthCloseSummarySchema) keeps what the month
--    ended with per envelope and the leftover rule it closed under, so a rule
--    changed later applies from the next close only (B7). Unique per book and
--    month: a lazy close racing another one turns into a skip. The app reads,
--    writes and updates (revisions, acknowledge); it never deletes a close.
-- 2. wealth_transfer: the budget's half of a money move (D24, SPEC §5.11,
--    MONEY-MOVES §5.2). TO_WEALTH takes money out of an envelope (or To
--    assign); FROM_WEALTH brings it into To assign or an envelope. countOnly
--    marks a Move in of income kept in Wealth. The row goes with what made
--    it: deleting the transfer (transfer.delete) or the kept income deletes
--    its budget side (CASCADE), so the budget never shows a move that is
--    gone. Amount is in the book currency, > 0. Undo deletes the row.
-- 3. RLS as every book table: members of the book, and a member writes only
--    as themself. Grants in this file (no FORCE, per 20260311000000).
-- Every table is new: nothing is backfilled and no existing table is rewritten.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MonthCloseMode') THEN
    CREATE TYPE "MonthCloseMode" AS ENUM ('AUTO', 'USER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WealthTransferDirection') THEN
    CREATE TYPE "WealthTransferDirection" AS ENUM ('TO_WEALTH', 'FROM_WEALTH');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "month_close" (
  "id"             TEXT             NOT NULL,
  "bookId"         TEXT             NOT NULL,
  "month"          INTEGER          NOT NULL,
  "mode"           "MonthCloseMode" NOT NULL DEFAULT 'AUTO',
  "closedAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revision"       INTEGER          NOT NULL DEFAULT 1,
  "summary"        JSONB            NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "ackRevision"    INTEGER,
  CONSTRAINT "month_close_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "month_close_month_check" CHECK ("month" % 100 BETWEEN 1 AND 12),
  CONSTRAINT "month_close_revision_check" CHECK ("revision" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "month_close_bookId_month_key" ON "month_close" ("bookId", "month");

CREATE TABLE IF NOT EXISTS "wealth_transfer" (
  "id"              TEXT                      NOT NULL,
  "bookId"          TEXT                      NOT NULL,
  "direction"       "WealthTransferDirection" NOT NULL,
  "envelopeId"      TEXT,
  "transferId"      TEXT,
  "sourceExpenseId" TEXT,
  "assetAccountId"  TEXT,
  "countOnly"       BOOLEAN                   NOT NULL DEFAULT false,
  "date"            DATE                      NOT NULL,
  "amount"          DECIMAL(19,8)             NOT NULL,
  "note"            VARCHAR(200),
  "actorUserId"     TEXT                      NOT NULL,
  "createdAt"       TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wealth_transfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wealth_transfer_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "wealth_transfer_bookId_date_idx" ON "wealth_transfer" ("bookId", "date");
CREATE INDEX IF NOT EXISTS "wealth_transfer_envelopeId_idx" ON "wealth_transfer" ("envelopeId");
CREATE INDEX IF NOT EXISTS "wealth_transfer_assetAccountId_idx" ON "wealth_transfer" ("assetAccountId");
-- One budget side per money move and per kept income moved in.
CREATE UNIQUE INDEX IF NOT EXISTS "wealth_transfer_transferId_key" ON "wealth_transfer" ("transferId");
CREATE UNIQUE INDEX IF NOT EXISTS "wealth_transfer_sourceExpenseId_key" ON "wealth_transfer" ("sourceExpenseId");

DO $$
DECLARE fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('month_close', 'month_close_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('wealth_transfer', 'wealth_transfer_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('wealth_transfer', 'wealth_transfer_envelopeId_bookId_fkey',
      'FOREIGN KEY ("envelopeId", "bookId") REFERENCES "envelope"("id", "bookId") ON DELETE NO ACTION ON UPDATE CASCADE'),
    ('wealth_transfer', 'wealth_transfer_transferId_fkey',
      'FOREIGN KEY ("transferId") REFERENCES "transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('wealth_transfer', 'wealth_transfer_sourceExpenseId_fkey',
      'FOREIGN KEY ("sourceExpenseId") REFERENCES "expense"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('wealth_transfer', 'wealth_transfer_assetAccountId_fkey',
      'FOREIGN KEY ("assetAccountId") REFERENCES "asset_account"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(tbl, name, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tbl, fk.name, fk.def);
    END IF;
  END LOOP;
END $$;

-- A close is kept for good: revisions update it in place.
GRANT SELECT, INSERT, UPDATE ON "month_close" TO retrospend_app;
REVOKE DELETE ON "month_close" FROM retrospend_app;
-- A budget side is written once and removed by its undo, never edited.
GRANT SELECT, INSERT, DELETE ON "wealth_transfer" TO retrospend_app;
REVOKE UPDATE ON "wealth_transfer" FROM retrospend_app;

ALTER TABLE "month_close" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wealth_transfer" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS month_close_access ON "month_close";
CREATE POLICY month_close_access ON "month_close"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

DROP POLICY IF EXISTS wealth_transfer_access ON "wealth_transfer";
CREATE POLICY wealth_transfer_access ON "wealth_transfer"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE))
              AND "actorUserId" = current_setting('app.current_user_id', TRUE));
