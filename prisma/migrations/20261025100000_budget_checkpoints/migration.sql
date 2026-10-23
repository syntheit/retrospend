-- Checkpoints, the stable past and book settings (budget build plan P4,
-- SPEC §5.5, §5.13). Placeholder timestamp: the orchestrator assigns the
-- final one at merge.
-- 1. month_close."checkpoint": the engine state at the end of the closed
--    month (carry into the next one, running totals, missing rates and a
--    fingerprint of the splits and Wealth rows up to it). A read starts its
--    pass at the latest valid one. "recalc": what a change to the month
--    after its late window did to today's numbers (C16). "lateEntries":
--    rows added inside the 7-day late window (C17).
-- 2. budget_dirty: marks that a budget month's inputs changed, written by
--    triggers on expense, wealth_transfer, shared_transaction,
--    split_participant, settlement, payment, project_participant, category
--    (kind) and exchange_rate (a rate appearing for an earlier date). A mark
--    invalidates the checkpoints from its month on; the next read under the
--    book lock recomputes those months, updates or revises their closes and
--    deletes the marks it saw. Insert-only from triggers, so writers never
--    wait on the book row or the book lock. A book collapses its marks into
--    one past 20, so a book nobody reads keeps a handful.
--    budget_book."dirtyFromMonth" (M6) stays unused: a single column would
--    make every expense write wait on the book row.
--    Moving a category to another envelope marks nothing: closed months
--    keep the routing they closed with (summary "links").
-- 3. budget_row_value: a foreign row's book value, frozen the first time
--    the budget values it at a rate dated on or before the row (rates are
--    updated in place every day, so a later lookup would use today's rate).
-- 4. budget_book: "lastOpenedAt" and "welcomeBackFrom" (Welcome back after
--    35 days away, S26), "reconciledAt" (monthly reconcile reminder after
--    the first one, SPEC §5.11), "planFundFrom" (a switch to Limits funds
--    from the next month, SPEC §4.4), "styleUndo" (what the last style
--    switch changed, so its undo never trusts the client).
-- RLS: budget_dirty and budget_row_value are book tables (members only);
-- the trigger functions are SECURITY DEFINER so a writer's mark reaches the
-- book whatever the writer's own policies allow. Additive and idempotent.

ALTER TABLE "month_close" ADD COLUMN IF NOT EXISTS "checkpoint" JSONB;
ALTER TABLE "month_close" ADD COLUMN IF NOT EXISTS "recalc" JSONB;
ALTER TABLE "month_close" ADD COLUMN IF NOT EXISTS "lateEntries" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "lastOpenedAt" TIMESTAMP(3);
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "welcomeBackFrom" TIMESTAMP(3);
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP(3);
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "planFundFrom" INTEGER;
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "styleUndo" JSONB;

CREATE INDEX IF NOT EXISTS "budget_book_currency_idx" ON "budget_book" ("currency");

CREATE TABLE IF NOT EXISTS "budget_dirty" (
  "id"        BIGSERIAL    NOT NULL,
  "bookId"    TEXT         NOT NULL,
  -- YYYYMM; 0 = from the book's start.
  "fromMonth" INTEGER      NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budget_dirty_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "budget_dirty_bookId_idx" ON "budget_dirty" ("bookId");

CREATE TABLE IF NOT EXISTS "budget_row_value" (
  "bookId"    TEXT         NOT NULL,
  -- Row id, currency, amount and date: an edited row is valued again.
  "key"       VARCHAR(300) NOT NULL,
  -- Book currency minor units.
  "minor"     BIGINT       NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budget_row_value_pkey" PRIMARY KEY ("bookId", "key")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_dirty_bookId_fkey') THEN
    ALTER TABLE "budget_dirty" ADD CONSTRAINT "budget_dirty_bookId_fkey"
      FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_row_value_bookId_fkey') THEN
    ALTER TABLE "budget_row_value" ADD CONSTRAINT "budget_row_value_bookId_fkey"
      FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON "budget_dirty" TO retrospend_app;
GRANT USAGE, SELECT ON SEQUENCE "budget_dirty_id_seq" TO retrospend_app;
REVOKE UPDATE ON "budget_dirty" FROM retrospend_app;
-- A frozen value is written once and never changed; an edited row gets a new key.
GRANT SELECT, INSERT ON "budget_row_value" TO retrospend_app;
REVOKE UPDATE, DELETE ON "budget_row_value" FROM retrospend_app;

ALTER TABLE "budget_dirty" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_dirty_access ON "budget_dirty";
CREATE POLICY budget_dirty_access ON "budget_dirty"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));

ALTER TABLE "budget_row_value" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_row_value_access ON "budget_row_value";
CREATE POLICY budget_row_value_access ON "budget_row_value"
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

-- One mark. Marks of one transaction from the same month or later are not
-- repeated; past 20 marks the book's marks collapse into one from the
-- earliest month (a reader deletes only the marks it saw, so the new one
-- survives any read in flight).
CREATE OR REPLACE FUNCTION budget_dirty_add(p_book TEXT, p_from INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
  low INTEGER;
BEGIN
  IF p_book IS NULL OR p_from IS NULL
     OR NOT EXISTS (SELECT 1 FROM "budget_book" WHERE "id" = p_book) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "budget_dirty"
    WHERE "bookId" = p_book AND "fromMonth" <= p_from
      AND "createdAt" = CURRENT_TIMESTAMP::timestamp(3)
  ) THEN
    RETURN;
  END IF;
  SELECT COUNT(*), MIN("fromMonth") INTO n, low FROM "budget_dirty" WHERE "bookId" = p_book;
  IF n >= 20 THEN
    DELETE FROM "budget_dirty" WHERE "bookId" = p_book;
    INSERT INTO "budget_dirty" ("bookId", "fromMonth") VALUES (p_book, LEAST(low, p_from));
    RETURN;
  END IF;
  INSERT INTO "budget_dirty" ("bookId", "fromMonth") VALUES (p_book, p_from);
END;
$$;

-- Marks the personal book of a user from the month of `p_at` (NULL: from the start).
CREATE OR REPLACE FUNCTION budget_dirty_user(p_user TEXT, p_at TIMESTAMP)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  FOR b IN
    SELECT bb."id", bb."timeZone",
           (SELECT COALESCE(MAX(p."startDay"), 1) FROM "book_period" p WHERE p."bookId" = bb."id") AS d
    FROM "budget_book" bb
    WHERE bb."createdById" = p_user AND bb."isPersonal"
  LOOP
    PERFORM budget_dirty_add(
      b."id",
      CASE WHEN p_at IS NULL THEN 0 ELSE budget_dirty_month(p_at, b."timeZone", b.d) END
    );
  END LOOP;
END;
$$;

-- The user behind a split party: a user, or whoever claimed a shadow.
CREATE OR REPLACE FUNCTION budget_party_user(p_type TEXT, p_id TEXT)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_type = 'user' THEN p_id
    WHEN p_type = 'shadow' THEN (SELECT s."claimedById" FROM "shadow_profile" s WHERE s."id" = p_id)
    ELSE NULL
  END
$$;

-- Statement triggers on expense: one mark per book per statement (imports
-- write thousands of rows in one statement).
CREATE OR REPLACE FUNCTION budget_dirty_expense_rows() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM budget_dirty_user(x."userId", x.at)
  FROM (SELECT "userId", MIN("date") AS at FROM changed_rows GROUP BY "userId") x;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION budget_dirty_expense_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM budget_dirty_user(x."userId", x.at)
  FROM (
    SELECT "userId", MIN("date") AS at
    FROM (SELECT "userId", "date" FROM old_rows UNION ALL SELECT "userId", "date" FROM changed_rows) c
    GROUP BY "userId"
  ) x;
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

-- Rates. Values are frozen once a row is valued (budget_row_value), so a
-- rate moving forward (the daily sync updates its row in place) changes
-- nothing. Only a rate appearing for an earlier date can value a row that
-- had none: a new row, or one moved back in time.
DROP TRIGGER IF EXISTS budget_dirty_rate_delete ON "exchange_rate";
DROP TRIGGER IF EXISTS budget_dirty_rate_update ON "exchange_rate";
DROP FUNCTION IF EXISTS budget_dirty_rate_update();

CREATE OR REPLACE FUNCTION budget_dirty_rate_rows() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM budget_dirty_add(
    b."id",
    budget_dirty_month(x.at, 'UTC',
      (SELECT COALESCE(MAX(p."startDay"), 1) FROM "book_period" p WHERE p."bookId" = b."id"))
  )
  FROM (SELECT "currency", MIN("date") AS at FROM changed_rows GROUP BY "currency") x
  JOIN "budget_book" b ON b."currency" = x."currency";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_rate_insert ON "exchange_rate";
CREATE TRIGGER budget_dirty_rate_insert
  AFTER INSERT ON "exchange_rate"
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION budget_dirty_rate_rows();

CREATE OR REPLACE FUNCTION budget_dirty_rate_back() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM budget_dirty_add(
    b."id",
    budget_dirty_month(NEW."date", 'UTC',
      (SELECT COALESCE(MAX(p."startDay"), 1) FROM "book_period" p WHERE p."bookId" = b."id"))
  )
  FROM "budget_book" b WHERE b."currency" = NEW."currency";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_rate_back ON "exchange_rate";
CREATE TRIGGER budget_dirty_rate_back
  AFTER UPDATE OF "date" ON "exchange_rate"
  FOR EACH ROW WHEN (NEW."date" < OLD."date")
  EXECUTE FUNCTION budget_dirty_rate_back();

-- Category links: closed months keep the routing they closed with.
DROP TRIGGER IF EXISTS budget_dirty_link ON "envelope_category";
DROP FUNCTION IF EXISTS budget_dirty_link();

-- A category turning into an income category leaves every spending sum.
CREATE OR REPLACE FUNCTION budget_dirty_category_kind() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM budget_dirty_user(NEW."userId", NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_category_kind ON "category";
CREATE TRIGGER budget_dirty_category_kind
  AFTER UPDATE OF "kind" ON "category"
  FOR EACH ROW WHEN (OLD."kind" IS DISTINCT FROM NEW."kind")
  EXECUTE FUNCTION budget_dirty_category_kind();

-- Wealth moves: the book they belong to, from their date.
CREATE OR REPLACE FUNCTION budget_dirty_book_day(p_book TEXT, p_day DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A calendar date: read in UTC so the zone shift does not move it.
  PERFORM budget_dirty_add(
    p_book,
    budget_dirty_month(p_day::timestamp, 'UTC',
      (SELECT COALESCE(MAX(p."startDay"), 1) FROM "book_period" p WHERE p."bookId" = p_book))
  );
END;
$$;

CREATE OR REPLACE FUNCTION budget_dirty_wealth() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM budget_dirty_book_day(OLD."bookId", OLD."date");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM budget_dirty_book_day(NEW."bookId", NEW."date");
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_wealth ON "wealth_transfer";
CREATE TRIGGER budget_dirty_wealth
  AFTER INSERT OR UPDATE OR DELETE ON "wealth_transfer"
  FOR EACH ROW EXECUTE FUNCTION budget_dirty_wealth();

-- Splits: the payer and every participant of the transaction, from its date.
CREATE OR REPLACE FUNCTION budget_dirty_split_tx(p_tx TEXT, p_at TIMESTAMP, p_payer_type TEXT, p_payer TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM budget_dirty_user(budget_party_user(p_payer_type, p_payer), p_at);
  PERFORM budget_dirty_user(budget_party_user(sp."participantType"::text, sp."participantId"), p_at)
  FROM "split_participant" sp WHERE sp."transactionId" = p_tx;
END;
$$;

CREATE OR REPLACE FUNCTION budget_dirty_shared_tx() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM budget_dirty_split_tx(OLD."id",
      CASE WHEN TG_OP = 'UPDATE' THEN LEAST(OLD."date", NEW."date") ELSE OLD."date" END,
      OLD."paidByType"::text, OLD."paidById");
  END IF;
  IF TG_OP = 'UPDATE' THEN
    PERFORM budget_dirty_user(budget_party_user(NEW."paidByType"::text, NEW."paidById"),
      LEAST(OLD."date", NEW."date"));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Before a delete, while the participants are still there to be found.
DROP TRIGGER IF EXISTS budget_dirty_shared_tx_delete ON "shared_transaction";
CREATE TRIGGER budget_dirty_shared_tx_delete
  BEFORE DELETE ON "shared_transaction"
  FOR EACH ROW EXECUTE FUNCTION budget_dirty_shared_tx();

DROP TRIGGER IF EXISTS budget_dirty_shared_tx_update ON "shared_transaction";
CREATE TRIGGER budget_dirty_shared_tx_update
  AFTER UPDATE ON "shared_transaction"
  FOR EACH ROW EXECUTE FUNCTION budget_dirty_shared_tx();

CREATE OR REPLACE FUNCTION budget_dirty_share_row(p_tx TEXT, p_type TEXT, p_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
BEGIN
  SELECT "date", "paidByType"::text AS payer_type, "paidById" INTO t
  FROM "shared_transaction" WHERE "id" = p_tx;
  -- Deleted with its transaction: the transaction's own trigger marked it.
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM budget_dirty_user(budget_party_user(p_type, p_id), t."date");
  PERFORM budget_dirty_user(budget_party_user(t.payer_type, t."paidById"), t."date");
END;
$$;

CREATE OR REPLACE FUNCTION budget_dirty_share() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM budget_dirty_share_row(OLD."transactionId", OLD."participantType"::text, OLD."participantId");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM budget_dirty_share_row(NEW."transactionId", NEW."participantType"::text, NEW."participantId");
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_share ON "split_participant";
CREATE TRIGGER budget_dirty_share
  AFTER INSERT OR UPDATE OR DELETE ON "split_participant"
  FOR EACH ROW EXECUTE FUNCTION budget_dirty_share();

-- Payments: both parties, from the earliest day the payment can count on.
CREATE OR REPLACE FUNCTION budget_dirty_settlement_row(s "settlement")
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  at TIMESTAMP := LEAST(s."initiatedAt", COALESCE(s."settledAt", s."initiatedAt"),
    COALESCE((SELECT pm."paidOn"::timestamp FROM "payment" pm WHERE pm."id" = s."paymentGroupId"),
             s."initiatedAt"));
BEGIN
  PERFORM budget_dirty_user(budget_party_user(s."fromParticipantType"::text, s."fromParticipantId"), at);
  PERFORM budget_dirty_user(budget_party_user(s."toParticipantType"::text, s."toParticipantId"), at);
END;
$$;

CREATE OR REPLACE FUNCTION budget_dirty_settlement() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM budget_dirty_settlement_row(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM budget_dirty_settlement_row(NEW); END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_settlement ON "settlement";
CREATE TRIGGER budget_dirty_settlement
  AFTER INSERT OR UPDATE OR DELETE ON "settlement"
  FOR EACH ROW EXECUTE FUNCTION budget_dirty_settlement();

CREATE OR REPLACE FUNCTION budget_dirty_payment() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  at TIMESTAMP := LEAST(OLD."paidOn", NEW."paidOn")::timestamp;
BEGIN
  PERFORM budget_dirty_user(budget_party_user(NEW."payerType"::text, NEW."payerId"), at);
  PERFORM budget_dirty_user(budget_party_user(NEW."payeeType"::text, NEW."payeeId"), at);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_payment ON "payment";
CREATE TRIGGER budget_dirty_payment
  AFTER UPDATE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION budget_dirty_payment();

-- Project routing ("Count my share in", D31) applies to the whole history.
CREATE OR REPLACE FUNCTION budget_dirty_routing() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM budget_dirty_user(budget_party_user(OLD."participantType"::text, OLD."participantId"), NULL);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM budget_dirty_user(budget_party_user(NEW."participantType"::text, NEW."participantId"), NULL);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_dirty_routing ON "project_participant";
CREATE TRIGGER budget_dirty_routing
  AFTER INSERT OR DELETE OR UPDATE OF "budgetRouting", "budgetEnvelopeId" ON "project_participant"
  FOR EACH ROW EXECUTE FUNCTION budget_dirty_routing();
