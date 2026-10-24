-- Payoff plan (budget build plan P6, SPEC §5.11). Placeholder timestamp: the
-- orchestrator assigns the final one at merge.
-- payoff_plan: one per book. Strategy (SNOWBALL smallest balance first,
-- AVALANCHE highest APR first, CUSTOM your order), the extra each month in
-- the book currency and the "Extra debt payment" envelope it funds. A
-- projection input only: it never writes money. "customOrder" holds
-- liability ids only (no text). Liability APR, minimum and due day already
-- live on asset_account (20261024300000 widened them).
-- RLS: a book table, members only. Additive and idempotent.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayoffStrategy') THEN
    CREATE TYPE "PayoffStrategy" AS ENUM ('SNOWBALL', 'AVALANCHE', 'CUSTOM');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "payoff_plan" (
  "id"           TEXT             NOT NULL,
  "bookId"       TEXT             NOT NULL,
  "strategy"     "PayoffStrategy" NOT NULL DEFAULT 'AVALANCHE',
  -- Book currency.
  "extraMonthly" DECIMAL(19,8)    NOT NULL DEFAULT 0,
  -- CUSTOM: [assetAccountId] in payoff order.
  "customOrder"  JSONB            NOT NULL DEFAULT '[]',
  "envelopeId"   TEXT,
  "createdAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "payoff_plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payoff_plan_bookId_key" ON "payoff_plan" ("bookId");

DO $$
DECLARE fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('payoff_plan', 'payoff_plan_bookId_fkey',
      'FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('payoff_plan', 'payoff_plan_envelopeId_bookId_fkey',
      'FOREIGN KEY ("envelopeId", "bookId") REFERENCES "envelope"("id", "bookId") ON DELETE NO ACTION ON UPDATE CASCADE')
  ) AS t(tbl, name, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tbl, fk.name, fk.def);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON "payoff_plan" TO retrospend_app;
REVOKE DELETE ON "payoff_plan" FROM retrospend_app;

ALTER TABLE "payoff_plan" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payoff_plan_access ON "payoff_plan";
CREATE POLICY payoff_plan_access ON "payoff_plan"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));
