-- Checkpoints, the stable past and book settings (budget build plan P4,
-- SPEC §5.5, §5.13). Placeholder timestamp: the orchestrator assigns the
-- final one at merge.
-- 1. month_close."checkpoint": the engine state at the end of the closed
--    month (carry into the next one, running totals, missing rates and a
--    fingerprint of the splits and Wealth rows up to it). A read starts its
--    pass at the latest valid one. "recalc": what a change to the month
--    after its late window did to today's numbers (C16). "lateEntries":
--    rows added or edited inside the 7-day late window (C17).
-- 2. budget_dirty: marks that a budget month's inputs changed, written by
--    triggers on expense, envelope_category, category (kind) and
--    exchange_rate (the book currency's rates). A mark invalidates the
--    checkpoints from its month on; the next read under the book lock
--    recomputes those months, updates or revises their closes and deletes
--    the marks it saw. Insert-only from triggers, so writers never wait on
--    the book row or the book lock. Splits, payments, routing and Wealth
--    moves are loaded in full on every read and fingerprinted instead.
--    budget_book."dirtyFromMonth" (M6) stays unused: a single column would
--    make every expense write wait on the book row.
-- 3. budget_book: "lastOpenedAt" and "welcomeBackFrom" (Welcome back after
--    35 days away, S26), "reconciledAt" (monthly reconcile reminder after
--    the first one, SPEC §5.11), "planFundFrom" (a switch to Limits funds
--    from the next month, SPEC §4.4).
-- RLS: budget_dirty is a book table (members only); the trigger functions
-- are SECURITY DEFINER so a writer's mark reaches the book whatever the
-- writer's own policies allow. Additive and idempotent.

ALTER TABLE "month_close" ADD COLUMN IF NOT EXISTS "checkpoint" JSONB;
ALTER TABLE "month_close" ADD COLUMN IF NOT EXISTS "recalc" JSONB;
ALTER TABLE "month_close" ADD COLUMN IF NOT EXISTS "lateEntries" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "lastOpenedAt" TIMESTAMP(3);
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "welcomeBackFrom" TIMESTAMP(3);
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP(3);
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "planFundFrom" INTEGER;

CREATE TABLE IF NOT EXISTS "budget_dirty" (
  "id"        BIGSERIAL    NOT NULL,
  "bookId"    TEXT         NOT NULL,
  -- YYYYMM; 0 = from the book's start.
  "fromMonth" INTEGER      NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budget_dirty_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "budget_dirty_bookId_idx" ON "budget_dirty" ("bookId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_dirty_bookId_fkey') THEN
    ALTER TABLE "budget_dirty" ADD CONSTRAINT "budget_dirty_bookId_fkey"
      FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON "budget_dirty" TO retrospend_app;
GRANT USAGE, SELECT ON SEQUENCE "budget_dirty_id_seq" TO retrospend_app;
REVOKE UPDATE ON "budget_dirty" FROM retrospend_app;

ALTER TABLE "budget_dirty" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_dirty_access ON "budget_dirty";
CREATE POLICY budget_dirty_access ON "budget_dirty"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

-- The earliest budget month a row dated `ts` can belong to in a book: its
-- calendar date in the book zone, one day earlier for slack; the month
-- before when the day is before the latest start day the book ever used.
-- Never later than the real budget month, sometimes one month earlier,
-- which only costs a recompute that finds nothing changed.
CREATE OR REPLACE FUNCTION budget_dirty_month(ts TIMESTAMP, tz TEXT, max_start_day INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d DATE := ((ts AT TIME ZONE 'UTC') AT TIME ZONE tz)::date - 1;
BEGIN
  IF EXTRACT(DAY FROM d) < max_start_day THEN
    d := (date_trunc('month', d) - INTERVAL '1 day')::date;
  END IF;
  RETURN (EXTRACT(YEAR FROM d) * 100 + EXTRACT(MONTH FROM d))::INTEGER;
END;
$$;

-- Statement triggers on expense: one mark per book per statement (imports
-- write thousands of rows in one statement).
CREATE OR REPLACE FUNCTION budget_dirty_expense_rows() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "budget_dirty" ("bookId", "fromMonth")
  SELECT b."id",
         MIN(budget_dirty_month(c."date", b."timeZone",
           (SELECT COALESCE(MAX(p."startDay"), 1) FROM "book_period" p WHERE p."bookId" = b."id")))
  FROM changed_rows c
  JOIN "budget_book" b ON b."createdById" = c."userId" AND b."isPersonal"
  GROUP BY b."id";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION budget_dirty_expense_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "budget_dirty" ("bookId", "fromMonth")
  SELECT b."id",
         MIN(budget_dirty_month(c."date", b."timeZone",
           (SELECT COALESCE(MAX(p."startDay"), 1) FROM "book_period" p WHERE p."bookId" = b."id")))
  FROM (SELECT "userId", "date" FROM old_rows UNION ALL SELECT "userId", "date" FROM changed_rows) c
  JOIN "budget_book" b ON b."createdById" = c."userId" AND b."isPersonal"
  GROUP BY b."id";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_expense_insert ON "expense";
CREATE TRIGGER budget_dirty_expense_insert
  AFTER INSERT ON "expense"
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION budget_dirty_expense_rows();

DROP TRIGGER IF EXISTS budget_dirty_expense_delete ON "expense";
CREATE TRIGGER budget_dirty_expense_delete
  AFTER DELETE ON "expense"
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION budget_dirty_expense_rows();

DROP TRIGGER IF EXISTS budget_dirty_expense_update ON "expense";
CREATE TRIGGER budget_dirty_expense_update
  AFTER UPDATE ON "expense"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION budget_dirty_expense_update();

-- Rates of a book's currency value its foreign rows (02 §3.4). A rate with
-- none of its kind before it was the fallback for every earlier row too
-- (nearest-rate rule), so that one marks the whole book.
CREATE OR REPLACE FUNCTION budget_dirty_rate_rows() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "budget_dirty" ("bookId", "fromMonth")
  SELECT b."id",
         MIN(CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM "exchange_rate" e
             WHERE e."currency" = c."currency" AND e."type" = c."type" AND e."date" < c."date"
           ) THEN 0
           ELSE budget_dirty_month(c."date", 'UTC',
             (SELECT COALESCE(MAX(p."startDay"), 1) FROM "book_period" p WHERE p."bookId" = b."id"))
         END)
  FROM changed_rows c
  JOIN "budget_book" b ON b."currency" = c."currency"
  GROUP BY b."id";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION budget_dirty_rate_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "budget_dirty" ("bookId", "fromMonth")
  SELECT b."id",
         MIN(CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM "exchange_rate" e
             WHERE e."currency" = c."currency" AND e."type" = c."type" AND e."date" < c."date"
           ) THEN 0
           ELSE budget_dirty_month(c."date", 'UTC',
             (SELECT COALESCE(MAX(p."startDay"), 1) FROM "book_period" p WHERE p."bookId" = b."id"))
         END)
  FROM (
    SELECT "currency", "type", "date" FROM old_rows
    UNION ALL
    SELECT "currency", "type", "date" FROM changed_rows
  ) c
  JOIN "budget_book" b ON b."currency" = c."currency"
  GROUP BY b."id";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_rate_insert ON "exchange_rate";
CREATE TRIGGER budget_dirty_rate_insert
  AFTER INSERT ON "exchange_rate"
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION budget_dirty_rate_rows();

DROP TRIGGER IF EXISTS budget_dirty_rate_delete ON "exchange_rate";
CREATE TRIGGER budget_dirty_rate_delete
  AFTER DELETE ON "exchange_rate"
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION budget_dirty_rate_rows();

DROP TRIGGER IF EXISTS budget_dirty_rate_update ON "exchange_rate";
CREATE TRIGGER budget_dirty_rate_update
  AFTER UPDATE ON "exchange_rate"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION budget_dirty_rate_update();

-- A category moved to another envelope routes its whole history there: the
-- book changes from its start. So does a category turning into an income
-- category (it leaves every spending sum).
CREATE OR REPLACE FUNCTION budget_dirty_link() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A link deleted with its book (cascade) marks nothing.
  INSERT INTO "budget_dirty" ("bookId", "fromMonth")
  SELECT b."id", 0 FROM "budget_book" b
  WHERE b."id" = COALESCE(NEW."bookId", OLD."bookId");
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_link ON "envelope_category";
CREATE TRIGGER budget_dirty_link
  AFTER INSERT OR UPDATE OR DELETE ON "envelope_category"
  FOR EACH ROW EXECUTE FUNCTION budget_dirty_link();

CREATE OR REPLACE FUNCTION budget_dirty_category_kind() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "budget_dirty" ("bookId", "fromMonth")
  SELECT b."id", 0 FROM "budget_book" b
  WHERE b."createdById" = NEW."userId" AND b."isPersonal";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_category_kind ON "category";
CREATE TRIGGER budget_dirty_category_kind
  AFTER UPDATE OF "kind" ON "category"
  FOR EACH ROW WHEN (OLD."kind" IS DISTINCT FROM NEW."kind")
  EXECUTE FUNCTION budget_dirty_category_kind();
