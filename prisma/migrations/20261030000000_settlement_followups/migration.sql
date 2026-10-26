-- Follow-ups to the settlement write RLS (20261029100000), from its review.
--
-- 1. An offset row's rate was free (0.000001 passed). It is now held to the
--    stored rate of its currency pair on the payment's date, within 0.2x to
--    5x. A rate the payer typed (rateType "custom") is held to the same band
--    on the payment itself, and a row labeled custom must equal it. With no
--    stored rate for the pair there is nothing to hold it to, and a missing
--    rate is never 1: the offset then stands only as the payment's own typed
--    rate. Cash rows are not checked (a small pair, KRW into ETH, rounds its
--    rate to 0 in six decimals). Rows already written are not looked at again
--    when their payment is confirmed: the band runs when rows or a typed rate
--    are written in the transaction.
--
-- 2. The SETTLED audit entry, which the confirm undo restores a claim from,
--    could be written by the receiver at any time with any content. It is now
--    written only in the transaction that finalized the rows, and what it
--    says the claim was (every row, and the header's amount, date, method and
--    rate) must equal what the database saw before that transaction touched
--    them. The rows an undo puts back must be rows of the newest SETTLED
--    entry of the payment.
--
-- 3. The marker that tells a rewrite from a plain delete was a transaction
--    setting (rs.ins_<md5>) the app role could set with set_config. The
--    markers, and the pre-images item 2 compares against, now live in
--    payment_tx_note, a table only the definer trigger functions below write.
--    A note is keyed by the transaction id, so it can never be read by another
--    transaction; notes of finished transactions are swept by the next write.
--
-- The app role only. The owner connection (guests, claims, user deletion, the
-- sweeps) is not subject to RLS or the triggers.

-- ------------------------------------------------------------
-- Notes of the running transaction. No policy, no grant: the app role cannot
-- read or write it, and cannot call the functions that do.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "payment_tx_note" (
  "txid" BIGINT NOT NULL,
  "kind" TEXT   NOT NULL,
  "key"  TEXT   NOT NULL,
  "data" JSONB,
  PRIMARY KEY ("txid", "kind", "key")
);
ALTER TABLE "payment_tx_note" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "payment_tx_note" FROM PUBLIC;
REVOKE ALL ON "payment_tx_note" FROM retrospend_app;

-- Remembers something about the running transaction. The first note of a key
-- wins (the pre-image is what it was before the transaction began). Notes of
-- transactions that ended (below the oldest running one) are deleted here.
CREATE OR REPLACE FUNCTION payment_tx_note_put(p_kind TEXT, p_key TEXT, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM "payment_tx_note" WHERE ctid IN (
    SELECT n.ctid FROM "payment_tx_note" n
    WHERE n."txid" < txid_snapshot_xmin(txid_current_snapshot())
    FOR UPDATE SKIP LOCKED
  );
  INSERT INTO "payment_tx_note" ("txid", "kind", "key", "data")
  VALUES (txid_current(), p_kind, p_key, p_data)
  ON CONFLICT ("txid", "kind", "key") DO NOTHING;
END
$$;

-- Whether the running transaction has this note.
CREATE OR REPLACE FUNCTION payment_tx_note_has(p_kind TEXT, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "payment_tx_note" n
    WHERE n."txid" = txid_current() AND n."kind" = p_kind AND n."key" = p_key
  )
$$;

-- A row of the payment is written in this transaction, and a row that becomes
-- final is remembered as final. Replaces the setting-based marker.
CREATE OR REPLACE FUNCTION settlement_mark_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."paymentGroupId" IS NOT NULL THEN
    PERFORM payment_tx_note_put('ins', NEW."paymentGroupId", NULL);
  END IF;
  IF NEW."status" = 'FINALIZED' THEN
    PERFORM payment_tx_note_put('final', NEW."id", NULL);
  END IF;
  RETURN NULL;
END
$$;

-- A waiting row is confirmed or taken apart: keep it as it stood. An update
-- to final also marks the row as finalized by this transaction.
CREATE OR REPLACE FUNCTION settlement_note_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM payment_tx_note_put('claim', OLD."id", to_jsonb(OLD));
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  PERFORM payment_tx_note_put('final', OLD."id", NULL);
  RETURN NEW;
END
$$;

-- The header of a waiting payment is confirmed: keep it as it stood.
CREATE OR REPLACE FUNCTION payment_note_header()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM payment_tx_note_put('hdr', OLD."id", to_jsonb(OLD));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS settlement_note_claim_update ON "settlement";
CREATE TRIGGER settlement_note_claim_update
  BEFORE UPDATE OF "status" ON "settlement"
  FOR EACH ROW WHEN (
    current_user = 'retrospend_app' AND OLD."status" = 'PROPOSED' AND NEW."status" = 'FINALIZED'
  )
  EXECUTE FUNCTION settlement_note_claim();

DROP TRIGGER IF EXISTS settlement_note_claim_delete ON "settlement";
CREATE TRIGGER settlement_note_claim_delete
  BEFORE DELETE ON "settlement"
  FOR EACH ROW WHEN (current_user = 'retrospend_app' AND OLD."status" = 'PROPOSED')
  EXECUTE FUNCTION settlement_note_claim();

DROP TRIGGER IF EXISTS payment_note_header ON "payment";
CREATE TRIGGER payment_note_header
  BEFORE UPDATE OF "status" ON "payment"
  FOR EACH ROW WHEN (
    current_user = 'retrospend_app' AND OLD."status" = 'PROPOSED' AND NEW."status" = 'FINALIZED'
  )
  EXECUTE FUNCTION payment_note_header();

-- settlement_mark_insert keeps its trigger (AFTER INSERT, app role only).
DROP TRIGGER IF EXISTS settlement_mark_insert ON "settlement";
CREATE TRIGGER settlement_mark_insert
  AFTER INSERT ON "settlement"
  FOR EACH ROW WHEN (current_user = 'retrospend_app')
  EXECUTE FUNCTION settlement_mark_insert();

-- A delete drops rows only with the whole payment, or when rows were written
-- into it in this same transaction (a rewrite).
CREATE OR REPLACE FUNCTION settlement_group_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user <> 'retrospend_app' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."paymentGroupId" IS NOT NULL THEN
      IF payment_has_rows(OLD."paymentGroupId")
         AND NOT payment_tx_note_has('ins', OLD."paymentGroupId") THEN
        RAISE EXCEPTION 'row-level security: a payment loses rows only as a whole or when rewritten'
          USING ERRCODE = '42501';
      END IF;
      PERFORM payment_group_check(OLD."paymentGroupId", TRUE);
    END IF;
  ELSIF NEW."paymentGroupId" IS NOT NULL THEN
    PERFORM payment_group_check(NEW."paymentGroupId", TRUE);
  END IF;
  RETURN NULL;
END
$$;

-- ------------------------------------------------------------
-- Rates. Fiat is stored per USD (ARS 1000 is 0.001 USD per ARS), crypto as USD
-- per coin (ETH 3000 is 3000 USD per ETH); packages/domain money.ts.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION rate_is_crypto(p_currency TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT upper(p_currency) IN ('BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'POL',
                               'LTC', 'DOT', 'LINK', 'TON', 'UNI', 'NEAR', 'SUI', 'BCH',
                               'USDC', 'USDT', 'DAI', 'BUSD')
$$;

-- What one unit of the currency is worth in USD on the date: the lowest and
-- highest over its rate types. For each type the latest rate on or before the
-- date wins, else the earliest after it (pickBestRate in money.ts). NULL when
-- the currency has no rate.
CREATE OR REPLACE FUNCTION rate_usd_range(p_currency TEXT, p_date TIMESTAMP, OUT lo NUMERIC, OUT hi NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF upper(p_currency) = 'USD' THEN
    lo := 1;
    hi := 1;
    RETURN;
  END IF;
  SELECT min(u.v), max(u.v) INTO lo, hi
  FROM (
    SELECT CASE WHEN rate_is_crypto(p_currency) THEN p."rate" ELSE 1 / p."rate" END AS v
    FROM (
      SELECT DISTINCT ON (er."type") er."rate"
      FROM "exchange_rate" er
      WHERE er."currency" = p_currency AND er."rate" > 0
      ORDER BY er."type",
               (er."date" <= p_date) DESC,
               CASE WHEN er."date" <= p_date THEN er."date" END DESC NULLS LAST,
               er."date" ASC
    ) p
  ) u;
END
$$;

-- Units of p_into per 1 unit of p_from, lowest and highest over the rate
-- types of both. NULL when either has no rate.
CREATE OR REPLACE FUNCTION rate_cross_band(p_from TEXT, p_into TEXT, p_date TIMESTAMP, OUT lo NUMERIC, OUT hi NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  f RECORD;
  t RECORD;
BEGIN
  SELECT * INTO f FROM rate_usd_range(p_from, p_date);
  SELECT * INTO t FROM rate_usd_range(p_into, p_date);
  IF f.lo IS NULL OR t.lo IS NULL THEN
    RETURN;
  END IF;
  lo := f.lo / t.hi;
  hi := f.hi / t.lo;
END
$$;

-- The rates of a payment written in this transaction: a typed rate on the
-- payment, and, when its rows were written too, every offset row in another
-- currency (see the header).
CREATE OR REPLACE FUNCTION payment_rates_check(p_id TEXT, p_rows BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  h "payment"%ROWTYPE;
  r RECORD;
  b RECORD;
  typed BOOLEAN;
BEGIN
  SELECT * INTO h FROM "payment" WHERE "id" = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF h."rateType" = 'custom' AND h."rate" IS NOT NULL AND h."rateCurrency" IS NOT NULL
     AND h."rateCurrency" <> h."currency" THEN
    SELECT * INTO b FROM rate_cross_band(h."rateCurrency", h."currency", h."paidOn"::timestamp);
    IF b.lo IS NOT NULL AND (h."rate" < b.lo * 0.2 OR h."rate" > b.hi * 5) THEN
      RAISE EXCEPTION 'row-level security: a typed rate is too far from the stored rate'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT p_rows THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT s."currency", s."exchangeRateUsed" AS rate, s."rateType"
    FROM "settlement" s
    WHERE s."paymentGroupId" = p_id AND s."isOffset"
      AND s."currency" <> h."currency" AND s."exchangeRateUsed" IS NOT NULL
  LOOP
    typed := h."rateType" = 'custom' AND h."rate" IS NOT NULL AND h."rateCurrency" = r.currency;
    -- A row keeps six decimals of the rate; the payment keeps twelve. Rounding half
    -- up or half to even may differ on a tie, so equal means within half a unit.
    IF typed AND r."rateType" = 'custom' AND abs(r.rate - h."rate") > 0.0000005 THEN
      RAISE EXCEPTION 'row-level security: an offset must use the rate typed on the payment'
        USING ERRCODE = '42501';
    END IF;
    SELECT * INTO b FROM rate_cross_band(r.currency, h."currency", h."paidOn"::timestamp);
    IF b.lo IS NULL THEN
      -- No stored rate to hold it to, and a missing rate is never 1.
      IF NOT (typed AND abs(r.rate - h."rate") <= 0.0000005) THEN
        RAISE EXCEPTION 'row-level security: there is no stored rate for an offset in %', r.currency
          USING ERRCODE = '42501';
      END IF;
    ELSIF r.rate < b.lo * 0.2 OR r.rate > b.hi * 5 THEN
      RAISE EXCEPTION 'row-level security: the rate of an offset in % is too far from the stored rate', r.currency
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
END
$$;

-- payment_group_check of 20261029100000 with the rate check added.
CREATE OR REPLACE FUNCTION payment_group_check(p_id TEXT, p_full BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid TEXT := current_setting('app.current_user_id', true);
  h "payment"%ROWTYPE;
  step NUMERIC;
  tol NUMERIC;
  theirs NUMERIC;
  mine NUMERIC;
  offsets INTEGER;
  rate_term NUMERIC;
BEGIN
  SELECT * INTO h FROM "payment" WHERE "id" = p_id;
  -- Gone (its rows with it), or not the caller's to ask about.
  IF NOT FOUND OR NOT (
    (h."payerType" = 'user' AND h."payerId" = uid)
    OR (h."payeeType" = 'user' AND h."payeeId" = uid)
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "settlement" s WHERE s."paymentGroupId" = p_id) THEN
    RAISE EXCEPTION 'row-level security: a payment keeps at least one row'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "settlement" s WHERE s."paymentGroupId" = p_id AND s."status" <> h."status"
  ) THEN
    RAISE EXCEPTION 'row-level security: the rows of a payment share its status'
      USING ERRCODE = '42501';
  END IF;
  IF NOT p_full THEN
    RETURN;
  END IF;

  IF h."amount" < 0 OR EXISTS (
    SELECT 1 FROM "settlement" s
    WHERE s."paymentGroupId" = p_id
      AND (s."amount" < 0 OR s."convertedAmount" < 0 OR s."exchangeRateUsed" < 0)
  ) THEN
    RAISE EXCEPTION 'row-level security: amounts and rates are not negative'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM "settlement" s WHERE s."paymentGroupId" = p_id AND s."kind" = 'FORGIVE') THEN
    -- A forgive: the payee lets a balance go, final at once, all rows alike.
    IF h."amount" <> 0
       OR NOT (h."recordedByType" = 'user' AND h."payeeType" = 'user' AND h."recordedById" = h."payeeId")
       OR EXISTS (
         SELECT 1 FROM "settlement" s
         WHERE s."paymentGroupId" = p_id
           AND NOT (
             s."kind" = 'FORGIVE'
             AND NOT s."isOffset"
             AND s."status" = 'FINALIZED'
             AND s."autoConfirmedReason" IS NOT NULL
             AND s."confirmedByPayer" AND s."confirmedByPayee"
             AND s."fromParticipantType" = h."payerType" AND s."fromParticipantId" = h."payerId"
             AND s."toParticipantType" = h."payeeType" AND s."toParticipantId" = h."payeeId"
             AND (
               s."forgiveEnvelopeId" IS NULL
               OR EXISTS (
                 SELECT 1 FROM "envelope" e
                 JOIN "budget_book" b ON b."id" = e."bookId"
                 WHERE e."id" = s."forgiveEnvelopeId" AND b."createdById" = h."payeeId"
               )
             )
           )
       ) THEN
      RAISE EXCEPTION 'row-level security: that is not a forgive the payee can make'
        USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "settlement" s WHERE s."paymentGroupId" = p_id AND s."forgiveEnvelopeId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'row-level security: only a forgive is charged to an envelope'
      USING ERRCODE = '42501';
  END IF;

  -- Offsets: a rate exactly when the currency is not the payment's, and the
  -- two sides worth the same.
  IF EXISTS (
    SELECT 1 FROM "settlement" s
    WHERE s."paymentGroupId" = p_id AND s."isOffset"
      AND (
        (s."currency" = h."currency" AND s."exchangeRateUsed" IS NOT NULL AND s."exchangeRateUsed" <> 1)
        OR (s."currency" <> h."currency" AND s."exchangeRateUsed" IS NULL)
        OR s."exchangeRateUsed" <= 0
      )
  ) THEN
    RAISE EXCEPTION 'row-level security: an offset in another currency needs its rate'
      USING ERRCODE = '42501';
  END IF;

  -- Rates written now are held to the stored ones; rows already there are not
  -- looked at again when only their status moves.
  IF payment_tx_note_has('ins', p_id) THEN
    PERFORM payment_rates_check(p_id, TRUE);
  ELSIF payment_tx_note_has('hdr', p_id) THEN
    PERFORM payment_rates_check(p_id, FALSE);
  END IF;

  SELECT
    COALESCE(SUM(s."amount" * COALESCE(s."exchangeRateUsed", 1))
      FILTER (WHERE s."fromParticipantType" = h."payeeType" AND s."fromParticipantId" = h."payeeId"), 0),
    COALESCE(SUM(s."amount" * COALESCE(s."exchangeRateUsed", 1))
      FILTER (WHERE s."fromParticipantType" = h."payerType" AND s."fromParticipantId" = h."payerId"), 0),
    COUNT(*),
    COALESCE(SUM(s."amount") FILTER (WHERE s."exchangeRateUsed" IS NOT NULL), 0) * 0.0000005
  INTO theirs, mine, offsets, rate_term
  FROM "settlement" s
  WHERE s."paymentGroupId" = p_id AND s."isOffset";

  step := currency_step(h."currency");
  tol := CASE WHEN upper(h."currency") = 'ARS' THEN 1 ELSE step END
         + offsets * step / 2 + rate_term
         + COALESCE((
             SELECT SUM(step / 2 + currency_step(s."currency") * s."exchangeRateUsed")
             FROM "settlement" s
             WHERE s."paymentGroupId" = p_id AND NOT s."isOffset" AND s."exchangeRateUsed" IS NOT NULL
           ), 0);
  IF abs(theirs - mine) > tol THEN
    RAISE EXCEPTION 'row-level security: the offsets of a payment cancel the same value on both sides'
      USING ERRCODE = '42501';
  END IF;
END
$$;

-- ------------------------------------------------------------
-- The SETTLED entry and the claim an undo puts back.
-- ------------------------------------------------------------

-- Two settlement rows as JSON (a snapshot row from the audit entry, a row from
-- the table) agree on everything that moves money or says who it is between.
CREATE OR REPLACE FUNCTION settlement_snapshot_matches(a JSONB, b JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'id', 'paymentGroupId', 'fromParticipantType', 'fromParticipantId',
      'toParticipantType', 'toParticipantId', 'currency', 'convertedCurrency',
      'projectId', 'billingPeriodId', 'kind', 'rateType', 'forgiveEnvelopeId',
      'autoConfirmedReason', 'status', 'confirmedByPayer', 'confirmedByPayee', 'isOffset'
    ]) k
    WHERE (a ->> k) IS DISTINCT FROM (b ->> k)
  ) AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['amount', 'convertedAmount', 'exchangeRateUsed']) k
    WHERE (a ->> k)::numeric IS DISTINCT FROM (b ->> k)::numeric
  )
$$;

-- Whether the user may write this SETTLED entry: they confirmed the row, the
-- row became final in this transaction, the entry names its payment, and the
-- claim it says was there is the claim this transaction found (every row, and
-- the header's amount, date, method and rate).
CREATE OR REPLACE FUNCTION settled_entry_ok(p_row_id TEXT, p_user_id TEXT, p_changes JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  pid TEXT;
  prev JSONB;
  hdr JSONB;
  seen INTEGER;
  claimed INTEGER;
  matched INTEGER;
BEGIN
  IF NOT settlement_confirmed_by(p_row_id, p_user_id)
     OR NOT payment_tx_note_has('final', p_row_id) THEN
    RETURN FALSE;
  END IF;
  SELECT s."paymentGroupId" INTO pid FROM "settlement" s WHERE s."id" = p_row_id;
  IF pid IS NULL OR (p_changes ->> 'paymentGroupId') IS DISTINCT FROM pid THEN
    RETURN FALSE;
  END IF;
  prev := p_changes -> 'previous';
  IF jsonb_typeof(prev) IS DISTINCT FROM 'object' OR jsonb_typeof(prev -> 'rows') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;

  SELECT count(*) INTO seen
  FROM "payment_tx_note" n
  WHERE n."txid" = txid_current() AND n."kind" = 'claim' AND n."data" ->> 'paymentGroupId' = pid;
  SELECT count(DISTINCT r ->> 'id') INTO claimed FROM jsonb_array_elements(prev -> 'rows') r;
  SELECT count(*) INTO matched
  FROM "payment_tx_note" n
  WHERE n."txid" = txid_current() AND n."kind" = 'claim' AND n."data" ->> 'paymentGroupId' = pid
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(prev -> 'rows') r
      WHERE settlement_snapshot_matches(r, n."data")
    );
  IF seen = 0 OR claimed <> seen OR matched <> seen
     OR jsonb_array_length(prev -> 'rows') <> seen THEN
    RETURN FALSE;
  END IF;

  SELECT n."data" INTO hdr
  FROM "payment_tx_note" n
  WHERE n."txid" = txid_current() AND n."kind" = 'hdr' AND n."key" = pid;
  IF hdr IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN (prev ->> 'amount')::numeric IS NOT DISTINCT FROM (hdr ->> 'amount')::numeric
    AND (prev ->> 'paidOn') IS NOT DISTINCT FROM (hdr ->> 'paidOn')
    AND (prev ->> 'paymentMethod') IS NOT DISTINCT FROM (hdr ->> 'paymentMethod')
    AND (prev ->> 'rateType') IS NOT DISTINCT FROM (hdr ->> 'rateType')
    AND (prev ->> 'rate')::numeric IS NOT DISTINCT FROM (hdr ->> 'rate')::numeric
    AND (prev ->> 'rateCurrency') IS NOT DISTINCT FROM (hdr ->> 'rateCurrency');
END
$$;

-- A waiting row inserted under a final payment is the confirm undo putting the
-- claim back: it must be a row of the newest SETTLED entry of the payment.
CREATE OR REPLACE FUNCTION claim_put_back_ok(p_payment_id TEXT, p_status "SettlementStatus", p_row JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  h "payment"%ROWTYPE;
  snap JSONB;
BEGIN
  IF p_payment_id IS NULL OR p_status <> 'PROPOSED' THEN
    RETURN TRUE;
  END IF;
  SELECT * INTO h FROM "payment" WHERE "id" = p_payment_id;
  IF NOT FOUND OR h."status" <> 'FINALIZED' THEN
    RETURN TRUE;
  END IF;
  SELECT a."changes" INTO snap
  FROM "audit_log_entry" a
  WHERE a."targetType" = 'SETTLEMENT' AND a."action" = 'SETTLED'
    AND a."changes" ->> 'paymentGroupId' = p_payment_id
  ORDER BY a."timestamp" DESC, a."id" DESC
  LIMIT 1;
  IF snap IS NULL OR jsonb_typeof(snap -> 'previous' -> 'rows') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM jsonb_array_elements(snap -> 'previous' -> 'rows') r
    WHERE settlement_snapshot_matches(r, p_row)
  );
END
$$;

CREATE INDEX IF NOT EXISTS "audit_log_entry_settled_payment_idx"
  ON "audit_log_entry" ((("changes" ->> 'paymentGroupId')), "timestamp")
  WHERE "action" = 'SETTLED' AND "targetType" = 'SETTLEMENT';

CREATE OR REPLACE FUNCTION settlement_guard_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT claim_put_back_ok(NEW."paymentGroupId", NEW."status", to_jsonb(NEW)) THEN
    RAISE EXCEPTION 'row-level security: a confirmed payment goes back only as its claim was'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS settlement_guard_insert ON "settlement";
CREATE TRIGGER settlement_guard_insert
  BEFORE INSERT ON "settlement"
  FOR EACH ROW WHEN (current_user = 'retrospend_app')
  EXECUTE FUNCTION settlement_guard_insert();

-- audit_log_entry: 20261029100000's policy, with the SETTLED entry bound to the
-- transaction that finalized the rows and to what the claim was.
DROP POLICY IF EXISTS "audit_log_entry_insert" ON "audit_log_entry";
CREATE POLICY "audit_log_entry_insert" ON "audit_log_entry"
    AS PERMISSIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      "actorType" = 'user'
      AND (
        (
          "actorId" = current_setting('app.current_user_id', true)
          AND (
            "targetType" <> 'SETTLEMENT'
            OR "action" <> 'SETTLED'
            OR settled_entry_ok("targetId", current_setting('app.current_user_id', true), "changes")
          )
        )
        OR (
          "actorId" = '__system__'
          AND "action" = 'AUTO_VERIFIED'
          AND "targetType" = 'SPLIT_PARTICIPANT'
          AND EXISTS (
            SELECT 1 FROM "split_participant" sp
            JOIN "shared_transaction" st ON st."id" = sp."transactionId"
            WHERE sp."id" = "audit_log_entry"."targetId"
              AND sp."participantType" = 'user'
              AND sp."participantId" = current_setting('app.current_user_id', true)
              AND sp."verificationStatus" = 'AUTO_ACCEPTED'
              AND st."projectId" IS NOT DISTINCT FROM "audit_log_entry"."projectId"
          )
        )
        -- Confirming a payment with a new amount rewrites the rows and records
        -- them (CREATED) under the person who first recorded them.
        OR (
          "targetType" = 'SETTLEMENT'
          AND "action" = 'CREATED'
          AND settlement_created_for(
            "targetId", "actorId", current_setting('app.current_user_id', true)
          )
        )
      )
    );

-- ------------------------------------------------------------
-- Function privileges. The note writers and the rate and snapshot helpers are
-- called only from definer functions and triggers; the app role gets only what
-- a policy or an invoker trigger calls.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION payment_tx_note_put(TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_tx_note_has(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_mark_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_note_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_note_header() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_group_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION rate_is_crypto(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION rate_usd_range(TEXT, TIMESTAMP) FROM PUBLIC;
REVOKE ALL ON FUNCTION rate_cross_band(TEXT, TEXT, TIMESTAMP) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_rates_check(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_group_check(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_snapshot_matches(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION settled_entry_ok(TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_put_back_ok(TEXT, "SettlementStatus", JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_guard_insert() FROM PUBLIC;
-- payment_tx_note_has is read by settlement_group_trigger (an invoker trigger),
-- settled_entry_ok by the audit policy, payment_group_check by the group triggers.
GRANT EXECUTE ON FUNCTION payment_tx_note_has(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION settled_entry_ok(TEXT, TEXT, JSONB) TO retrospend_app;
GRANT EXECUTE ON FUNCTION payment_group_check(TEXT, BOOLEAN) TO retrospend_app;
