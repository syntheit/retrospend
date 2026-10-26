-- Fix: a party to a payment could rewrite it at the database level, and could
-- forge the audit entry the confirm undo restores from.
--
-- settlement_access and payment_access (20260316000000, 20261023200000) were
-- single FOR ALL policies whose WITH CHECK only asked "am I a party". So a
-- party could change settlement.amount, currency, the people on a row or its
-- status (confirm their own payment, bring back a rejected one) with a plain
-- UPDATE; a user who only shared a project with both parties could delete the
-- rows (DELETE has no WITH CHECK, and USING includes project members); and
-- anyone could write a SETTLED audit entry in their own name, which
-- confirm-restore.ts restores rows from. The app checks first, so none of it
-- is reachable through the app today, but RLS has to hold on its own.
--
-- A payment has a recorder (payment.recordedBy*, the person who entered it) and
-- a receiver (the other party, who confirms or rejects it). What each command
-- allows now (the app role only; the owner connection used by guests, claims,
-- user deletion and the sweeps is not subject to RLS or the triggers):
--
--   payment
--     SELECT  unchanged (a party, or a user who shares a project with both).
--     INSERT  the recorder, who is one of the two people. Pending only when the
--             recorder is the payer. Final at once only when the recorder is
--             the payee (money received) or the payee cannot confirm (shadow,
--             guest).
--     UPDATE  a party. Nobody changes the people, the currency, the id or the
--             recorder. The receiver moves the status (PROPOSED to FINALIZED or
--             REJECTED; FINALIZED back to PROPOSED when no row is final any
--             more) and, with that move, sets amount, rate, date and method.
--     DELETE  the recorder (or a user, when the recorder is a shadow or guest),
--             once no settlement row is left.
--   settlement
--     SELECT  unchanged.
--     INSERT  a party, onto an existing payment of the same two people, into a
--             project one of them is in. The recorder writes PROPOSED rows with
--             only their own flag set, or FINAL rows (with an auto-confirm
--             reason) when the payee is the recorder or cannot confirm. The
--             receiver writes only PAYMENT rows, and only what a confirm with a
--             new amount writes (final rows, payment pending) or what the
--             confirm undo puts back (claim rows, payment final). Cash rows go
--             payer to payee.
--     UPDATE  a party. People, amounts, currency, project, kind and rate never
--             change (trigger). Note and method may. A reminder only from the
--             recorder, one at a time, up to three, while pending. Status moves
--             as on the payment; flags and dates move only with it.
--     DELETE  a party: a row that is pending or rejected; a final row the
--             recorder made final alone (void; a user may void one a shadow or
--             guest recorded); a final row both agreed to, by the receiver only
--             (confirm undo).
--   a payment as a whole (constraint triggers, checked at commit, so a payment
--   is written in one transaction)
--     A payment has rows and its rows share its status. Rows are not negative.
--     Offset rows balance in the payment currency (within rounding and the
--     rate precision the rows store), and carry a rate exactly when their
--     currency is not the payment's. A FORGIVE payment is all FORGIVE rows, from
--     the payer to the payee who recorded it, final at once, with an envelope
--     of the payee's (or none); no PAYMENT row carries an envelope.
--   audit_log_entry
--     INSERT  in your own name; the system's only for the AUTO_VERIFIED entry
--             of your own auto-accepted split. A SETTLED entry of a payment
--             only by its receiver, once it is final: it is what the confirm
--             undo restores from. The recorder's name, by a party, only on the
--             CREATED entry of a row that has none yet (the receiver rewriting
--             rows under the recorder's name).

-- ------------------------------------------------------------
-- Helpers. SECURITY DEFINER so a policy or trigger can read the payment
-- without going through its own policy. Each answers only about a payment the
-- caller is a party to (anyone else gets false), so none of them can be asked
-- about other people's payments; only the app role may call them.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION payment_recorded_by(p_payment_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "payment" p
    WHERE p."id" = p_payment_id
      AND p."recordedByType" = 'user'
      AND p."recordedById" = p_user_id
      AND (
        (p."payerType" = 'user' AND p."payerId" = current_setting('app.current_user_id', true))
        OR (p."payeeType" = 'user' AND p."payeeId" = current_setting('app.current_user_id', true))
      )
  )
$$;

CREATE OR REPLACE FUNCTION payment_has_rows(p_payment_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "payment" p
    WHERE p."id" = p_payment_id
      AND (
        (p."payerType" = 'user' AND p."payerId" = current_setting('app.current_user_id', true))
        OR (p."payeeType" = 'user' AND p."payeeId" = current_setting('app.current_user_id', true))
      )
  ) AND EXISTS (SELECT 1 FROM "settlement" s WHERE s."paymentGroupId" = p_payment_id)
$$;

-- A row of the payment is final. A payment cannot go back to waiting while one is.
CREATE OR REPLACE FUNCTION payment_has_final_rows(p_payment_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "payment" p
    WHERE p."id" = p_payment_id
      AND (
        (p."payerType" = 'user' AND p."payerId" = current_setting('app.current_user_id', true))
        OR (p."payeeType" = 'user' AND p."payeeId" = current_setting('app.current_user_id', true))
      )
  ) AND EXISTS (
    SELECT 1 FROM "settlement" s
    WHERE s."paymentGroupId" = p_payment_id AND s."status" = 'FINALIZED'
  )
$$;

-- The smallest unit money in the currency is kept to (packages/domain money.ts:
-- 0, 3 or 4 decimals for the listed currencies, 2 for the rest; crypto is
-- treated as 2, which only makes the offset tolerance below looser).
CREATE OR REPLACE FUNCTION currency_step(p_currency TEXT)
RETURNS NUMERIC
LANGUAGE SQL
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN upper(p_currency) IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
                               'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF')
      THEN 1::numeric
    WHEN upper(p_currency) IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND')
      THEN 0.001::numeric
    WHEN upper(p_currency) IN ('CLF', 'UYW') THEN 0.0001::numeric
    ELSE 0.01::numeric
  END
$$;

-- Whether the user may write this settlement row as a new row.
CREATE OR REPLACE FUNCTION settlement_insert_ok(
  p_user_id TEXT,
  p_payment_id TEXT,
  p_from_type TEXT, p_from_id TEXT,
  p_to_type TEXT, p_to_id TEXT,
  p_status "SettlementStatus",
  p_confirmed_payer BOOLEAN,
  p_confirmed_payee BOOLEAN,
  p_reason TEXT,
  p_is_offset BOOLEAN,
  p_kind TEXT,
  p_project_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  h "payment"%ROWTYPE;
  from_is_recorder BOOLEAN;
  recorder_flag BOOLEAN;
  other_flag BOOLEAN;
BEGIN
  SELECT * INTO h FROM "payment" WHERE "id" = p_payment_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  -- The row is between the two people of the payment.
  IF NOT (
    (h."payerType"::text = p_from_type AND h."payerId" = p_from_id
       AND h."payeeType"::text = p_to_type AND h."payeeId" = p_to_id)
    OR (h."payeeType"::text = p_from_type AND h."payeeId" = p_from_id
       AND h."payerType"::text = p_to_type AND h."payerId" = p_to_id)
  ) THEN
    RETURN FALSE;
  END IF;
  -- Cash goes from the payer to the payee; only an offset row goes back (the
  -- payment as a whole must then balance, see payment_group_check).
  IF NOT COALESCE(p_is_offset, FALSE) AND NOT (
    h."payerType"::text = p_from_type AND h."payerId" = p_from_id
  ) THEN
    RETURN FALSE;
  END IF;
  -- Into a project one of the two people is in.
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "project_participant" pp
    WHERE pp."projectId" = p_project_id
      AND (
        (pp."participantType"::text = p_from_type AND pp."participantId" = p_from_id)
        OR (pp."participantType"::text = p_to_type AND pp."participantId" = p_to_id)
      )
  ) THEN
    RETURN FALSE;
  END IF;

  from_is_recorder := h."recordedByType"::text = p_from_type AND h."recordedById" = p_from_id;
  recorder_flag := CASE WHEN from_is_recorder THEN p_confirmed_payer ELSE p_confirmed_payee END;
  other_flag := CASE WHEN from_is_recorder THEN p_confirmed_payee ELSE p_confirmed_payer END;

  IF h."recordedByType" = 'user' AND h."recordedById" = p_user_id THEN
    -- The recorder: pending with only their flag (they are the payer), or
    -- final alone when the payee is the recorder or cannot confirm.
    IF p_status = 'PROPOSED' THEN
      RETURN p_reason IS NULL AND recorder_flag AND NOT other_flag
        AND h."payerType" = 'user' AND h."payerId" = p_user_id;
    ELSIF p_status = 'FINALIZED' THEN
      RETURN p_reason IS NOT NULL AND recorder_flag AND (
        (h."payeeType" = 'user' AND h."payeeId" = p_user_id) OR h."payeeType" <> 'user'
      );
    END IF;
    RETURN FALSE;
  END IF;

  -- The other party rewrites payment rows in two cases only, never a forgive.
  IF p_kind <> 'PAYMENT' THEN
    RETURN FALSE;
  END IF;
  IF p_status = 'FINALIZED' AND h."status" = 'PROPOSED' THEN
    -- Confirming with a new amount: final rows, both agreed, no auto reason.
    RETURN p_reason IS NULL AND p_confirmed_payer AND p_confirmed_payee;
  ELSIF p_status = 'PROPOSED' AND h."status" = 'FINALIZED' THEN
    -- Undoing a confirm puts the recorder's claim back.
    RETURN p_reason IS NULL AND recorder_flag AND NOT other_flag;
  END IF;
  RETURN FALSE;
END
$$;

-- Whether the user may delete a settlement row in this state.
CREATE OR REPLACE FUNCTION settlement_delete_ok(
  p_user_id TEXT,
  p_payment_id TEXT,
  p_status "SettlementStatus",
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  h "payment"%ROWTYPE;
  by_user BOOLEAN;
BEGIN
  IF p_status IN ('PROPOSED', 'REJECTED') THEN
    RETURN TRUE;
  END IF;
  SELECT * INTO h FROM "payment" WHERE "id" = p_payment_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  by_user := h."recordedByType" = 'user' AND h."recordedById" = p_user_id;
  IF p_reason IS NOT NULL THEN
    -- Final without the other side: the recorder voids it; so does the user
    -- when a shadow or guest recorded it (the other side cannot).
    RETURN by_user OR h."recordedByType" <> 'user';
  END IF;
  -- Final with both sides' agreement: the receiver takes their confirm back.
  RETURN NOT by_user;
END
$$;

-- The user is a party to this final row and did not record it: the one who
-- confirmed it. Only they may write the SETTLED entry of a payment.
CREATE OR REPLACE FUNCTION settlement_confirmed_by(p_row_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "settlement" s
    JOIN "payment" p ON p."id" = s."paymentGroupId"
    WHERE s."id" = p_row_id
      AND s."status" = 'FINALIZED'
      AND (
        (s."fromParticipantType" = 'user' AND s."fromParticipantId" = p_user_id)
        OR (s."toParticipantType" = 'user' AND s."toParticipantId" = p_user_id)
      )
      AND NOT (p."recordedByType" = 'user' AND p."recordedById" = p_user_id)
  )
$$;

-- The user is a party to this row, the actor recorded its payment, and no
-- CREATED entry names the row yet: the receiver recording a rewrite under the
-- recorder's name, once.
CREATE OR REPLACE FUNCTION settlement_created_for(p_row_id TEXT, p_actor_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "settlement" s
    JOIN "payment" p ON p."id" = s."paymentGroupId"
    WHERE s."id" = p_row_id
      AND (
        (s."fromParticipantType" = 'user' AND s."fromParticipantId" = p_user_id)
        OR (s."toParticipantType" = 'user' AND s."toParticipantId" = p_user_id)
      )
      AND p."recordedByType" = 'user' AND p."recordedById" = p_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM "audit_log_entry" a
    WHERE a."targetType" = 'SETTLEMENT' AND a."targetId" = p_row_id AND a."action" = 'CREATED'
  )
$$;

-- ------------------------------------------------------------
-- Update guards (triggers, because a policy cannot compare old and new).
-- They bind the app role only; the owner connection is not limited.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION settlement_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  uid TEXT := current_setting('app.current_user_id', true);
  free TEXT[] := ARRAY['paymentMethod', 'note', 'reminderSentAt', 'reminderCount'];
  moving TEXT[] := ARRAY['status', 'confirmedByPayer', 'confirmedByPayee', 'settledAt',
                         'rejectedAt', 'rejectedReason'];
  h "payment"%ROWTYPE;
  recorder TEXT;
  recorder_is_from BOOLEAN;
  legal BOOLEAN := FALSE;
BEGIN
  IF current_user <> 'retrospend_app' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - free - moving) IS DISTINCT FROM (to_jsonb(OLD) - free - moving) THEN
    RAISE EXCEPTION 'row-level security: a payment keeps its people, amounts and currency'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO h FROM "payment" WHERE "id" = OLD."paymentGroupId";
  IF FOUND THEN
    recorder := h."recordedByType"::text || ':' || h."recordedById";
  END IF;

  -- A reminder: only the recorder, one more at a time, up to three, while pending.
  IF NEW."reminderCount" IS DISTINCT FROM OLD."reminderCount"
     OR NEW."reminderSentAt" IS DISTINCT FROM OLD."reminderSentAt" THEN
    IF recorder IS DISTINCT FROM 'user:' || COALESCE(uid, '')
       OR OLD."status" <> 'PROPOSED' OR NEW."status" <> 'PROPOSED'
       OR NEW."reminderCount" <> OLD."reminderCount" + 1
       OR NEW."reminderCount" > 3
       OR NEW."reminderSentAt" IS NULL THEN
      RAISE EXCEPTION 'row-level security: only the person who recorded a pending payment reminds, up to three times'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (to_jsonb(NEW) - free) IS NOT DISTINCT FROM (to_jsonb(OLD) - free) THEN
    RETURN NEW;
  END IF;

  -- Status, flags or dates moved: only the receiver, and only the legal way.
  IF recorder IS NULL OR recorder = 'user:' || COALESCE(uid, '') THEN
    RAISE EXCEPTION 'row-level security: only the other person moves a payment on'
      USING ERRCODE = '42501';
  END IF;
  recorder_is_from := recorder = OLD."fromParticipantType"::text || ':' || OLD."fromParticipantId";

  IF OLD."status" = 'PROPOSED' AND NEW."status" = 'FINALIZED' THEN
    legal := NEW."confirmedByPayer" AND NEW."confirmedByPayee" AND NEW."settledAt" IS NOT NULL
      AND NEW."rejectedAt" IS NOT DISTINCT FROM OLD."rejectedAt"
      AND NEW."rejectedReason" IS NOT DISTINCT FROM OLD."rejectedReason";
  ELSIF OLD."status" = 'PROPOSED' AND NEW."status" = 'REJECTED' THEN
    legal := NEW."rejectedAt" IS NOT NULL
      AND NEW."confirmedByPayer" = OLD."confirmedByPayer"
      AND NEW."confirmedByPayee" = OLD."confirmedByPayee"
      AND NEW."settledAt" IS NOT DISTINCT FROM OLD."settledAt";
  ELSIF OLD."status" = 'FINALIZED' AND NEW."status" = 'PROPOSED' THEN
    -- Only a confirm both agreed to can be taken back.
    legal := OLD."autoConfirmedReason" IS NULL
      AND NEW."settledAt" IS NULL
      AND NEW."confirmedByPayer" = recorder_is_from
      AND NEW."confirmedByPayee" = NOT recorder_is_from
      AND NEW."rejectedAt" IS NOT DISTINCT FROM OLD."rejectedAt"
      AND NEW."rejectedReason" IS NOT DISTINCT FROM OLD."rejectedReason";
  END IF;
  IF NOT legal THEN
    RAISE EXCEPTION 'row-level security: that is not a way a payment can move'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS settlement_guard_update ON "settlement";
CREATE TRIGGER settlement_guard_update
  BEFORE UPDATE ON "settlement"
  FOR EACH ROW EXECUTE FUNCTION settlement_guard_update();

CREATE OR REPLACE FUNCTION payment_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  uid TEXT := current_setting('app.current_user_id', true);
  free TEXT[] := ARRAY['note', 'updatedAt'];
  moved TEXT[] := ARRAY['status', 'amount', 'paidOn', 'paymentMethod', 'rateType', 'rate', 'rateCurrency'];
  legal BOOLEAN := FALSE;
BEGIN
  IF current_user <> 'retrospend_app' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - free - moved) IS DISTINCT FROM (to_jsonb(OLD) - free - moved) THEN
    RAISE EXCEPTION 'row-level security: a payment keeps its people and currency'
      USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - free) IS NOT DISTINCT FROM (to_jsonb(OLD) - free) THEN
    RETURN NEW;
  END IF;

  IF OLD."recordedByType" = 'user' AND OLD."recordedById" IS NOT DISTINCT FROM uid THEN
    RAISE EXCEPTION 'row-level security: only the other person moves a payment on'
      USING ERRCODE = '42501';
  END IF;
  IF OLD."status" = 'PROPOSED' AND NEW."status" = 'FINALIZED' THEN
    legal := TRUE;
  ELSIF OLD."status" = 'PROPOSED' AND NEW."status" = 'REJECTED' THEN
    legal := (to_jsonb(NEW) - free - 'status') IS NOT DISTINCT FROM (to_jsonb(OLD) - free - 'status');
  ELSIF OLD."status" = 'FINALIZED' AND NEW."status" = 'PROPOSED' THEN
    -- Back to waiting only once no row is final any more (they were put back
    -- first), so a final row is never left under a waiting payment.
    legal := NOT payment_has_final_rows(OLD."id");
  END IF;
  IF NOT legal THEN
    RAISE EXCEPTION 'row-level security: that is not a way a payment can move'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS payment_guard_update ON "payment";
CREATE TRIGGER payment_guard_update
  BEFORE UPDATE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION payment_guard_update();

-- ------------------------------------------------------------
-- A payment as a whole, checked at commit (constraint triggers). The app
-- writes a header, its rows and any rewrite in one transaction, so the state
-- it leaves behind is what is checked; a single statement that would leave a
-- payment half written is refused.
--
--   always  the payment has rows, and every row has the payment's status
--           (a forged final row cannot sit under a waiting or rejected payment)
--   on rows just written
--           no row is negative; offset rows balance and carry a rate exactly
--           when their currency is not the payment's; a forgive is whole
--
-- Offset rows move no cash: payee-to-payer rows cancel what the payee owed,
-- payer-to-payee rows what the payer owed, and the two sides are worth the
-- same in the payment currency (allocate.ts, I2). A row's worth is its
-- amount times the rate it stores (6 decimals), so the sides may differ by the
-- rounding of each row, the rate precision, and the payment's dust (one unit
-- for ARS, else one minor unit). The rate itself is not checked against a
-- market quote: the database has none.
--
-- The triggers queue an event only for the app role (WHEN), so the owner
-- connection (sweeps, claims, migrations) neither pays for them nor is
-- blocked by them.
-- ------------------------------------------------------------

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
      )
  ) THEN
    RAISE EXCEPTION 'row-level security: an offset in another currency needs its rate'
      USING ERRCODE = '42501';
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
         + offsets * step / 2 + rate_term;
  IF abs(theirs - mine) > tol THEN
    RAISE EXCEPTION 'row-level security: the offsets of a payment cancel the same value on both sides'
      USING ERRCODE = '42501';
  END IF;
END
$$;

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
      PERFORM payment_group_check(OLD."paymentGroupId", FALSE);
    END IF;
  ELSIF NEW."paymentGroupId" IS NOT NULL THEN
    PERFORM payment_group_check(NEW."paymentGroupId", TG_OP = 'INSERT');
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION payment_group_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'retrospend_app' THEN
    PERFORM payment_group_check(NEW."id", FALSE);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS settlement_group_insert ON "settlement";
CREATE CONSTRAINT TRIGGER settlement_group_insert
  AFTER INSERT ON "settlement"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (current_user = 'retrospend_app')
  EXECUTE FUNCTION settlement_group_trigger();

DROP TRIGGER IF EXISTS settlement_group_status ON "settlement";
CREATE CONSTRAINT TRIGGER settlement_group_status
  AFTER UPDATE OF "status" ON "settlement"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (current_user = 'retrospend_app')
  EXECUTE FUNCTION settlement_group_trigger();

DROP TRIGGER IF EXISTS settlement_group_delete ON "settlement";
CREATE CONSTRAINT TRIGGER settlement_group_delete
  AFTER DELETE ON "settlement"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (current_user = 'retrospend_app')
  EXECUTE FUNCTION settlement_group_trigger();

DROP TRIGGER IF EXISTS payment_group_insert ON "payment";
CREATE CONSTRAINT TRIGGER payment_group_insert
  AFTER INSERT ON "payment"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (current_user = 'retrospend_app')
  EXECUTE FUNCTION payment_group_trigger();

DROP TRIGGER IF EXISTS payment_group_status ON "payment";
CREATE CONSTRAINT TRIGGER payment_group_status
  AFTER UPDATE OF "status" ON "payment"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (current_user = 'retrospend_app')
  EXECUTE FUNCTION payment_group_trigger();

-- ------------------------------------------------------------
-- settlement policies
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "settlement_access" ON "settlement";
DROP POLICY IF EXISTS "settlement_select" ON "settlement";
DROP POLICY IF EXISTS "settlement_insert" ON "settlement";
DROP POLICY IF EXISTS "settlement_update" ON "settlement";
DROP POLICY IF EXISTS "settlement_delete" ON "settlement";

-- Same reach as before: a party, or a user who shares a project with both.
CREATE POLICY "settlement_select" ON "settlement"
    AS PERMISSIVE FOR SELECT TO retrospend_app
    USING (
      ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
      OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
      OR EXISTS (
        SELECT 1 FROM "project_participant" pp_self
        WHERE pp_self."participantType" = 'user'
          AND pp_self."participantId" = current_setting('app.current_user_id', true)
          AND EXISTS (
            SELECT 1 FROM "project_participant" pp_from
            WHERE pp_from."projectId" = pp_self."projectId"
              AND pp_from."participantType" = "settlement"."fromParticipantType"
              AND pp_from."participantId" = "settlement"."fromParticipantId"
          )
          AND EXISTS (
            SELECT 1 FROM "project_participant" pp_to
            WHERE pp_to."projectId" = pp_self."projectId"
              AND pp_to."participantType" = "settlement"."toParticipantType"
              AND pp_to."participantId" = "settlement"."toParticipantId"
          )
      )
    );

CREATE POLICY "settlement_insert" ON "settlement"
    AS PERMISSIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      (
        ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
        OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
      )
      AND settlement_insert_ok(
        current_setting('app.current_user_id', true),
        "paymentGroupId",
        "fromParticipantType"::text, "fromParticipantId",
        "toParticipantType"::text, "toParticipantId",
        "status", "confirmedByPayer", "confirmedByPayee",
        "autoConfirmedReason", "isOffset", "kind"::text, "projectId"
      )
    );

CREATE POLICY "settlement_update" ON "settlement"
    AS PERMISSIVE FOR UPDATE TO retrospend_app
    USING (
      ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
      OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
      OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
    );

CREATE POLICY "settlement_delete" ON "settlement"
    AS PERMISSIVE FOR DELETE TO retrospend_app
    USING (
      (
        ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
        OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
      )
      AND settlement_delete_ok(
        current_setting('app.current_user_id', true),
        "paymentGroupId", "status", "autoConfirmedReason"
      )
    );

-- ------------------------------------------------------------
-- payment policies
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "payment_access" ON "payment";
DROP POLICY IF EXISTS "payment_select" ON "payment";
DROP POLICY IF EXISTS "payment_insert" ON "payment";
DROP POLICY IF EXISTS "payment_update" ON "payment";
DROP POLICY IF EXISTS "payment_delete" ON "payment";

CREATE POLICY "payment_select" ON "payment"
    AS PERMISSIVE FOR SELECT TO retrospend_app
    USING (
      ("payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true))
      OR ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
      OR EXISTS (
        SELECT 1 FROM "project_participant" pp_self
        WHERE pp_self."participantType" = 'user'
          AND pp_self."participantId" = current_setting('app.current_user_id', true)
          AND EXISTS (
            SELECT 1 FROM "project_participant" pp_from
            WHERE pp_from."projectId" = pp_self."projectId"
              AND pp_from."participantType" = "payment"."payerType"
              AND pp_from."participantId" = "payment"."payerId"
          )
          AND EXISTS (
            SELECT 1 FROM "project_participant" pp_to
            WHERE pp_to."projectId" = pp_self."projectId"
              AND pp_to."participantType" = "payment"."payeeType"
              AND pp_to."participantId" = "payment"."payeeId"
          )
      )
    );

CREATE POLICY "payment_insert" ON "payment"
    AS PERMISSIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      "recordedByType" = 'user'
      AND "recordedById" = current_setting('app.current_user_id', true)
      AND (
        ("payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true))
        OR ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
      )
      AND (
        -- Waiting for the payee: the payer's claim, never the payee's own.
        (
          "status" = 'PROPOSED'
          AND "payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true)
        )
        OR (
          "status" = 'FINALIZED'
          AND (
            ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
            OR "payeeType" <> 'user'
          )
        )
      )
    );

CREATE POLICY "payment_update" ON "payment"
    AS PERMISSIVE FOR UPDATE TO retrospend_app
    USING (
      ("payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true))
      OR ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      ("payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true))
      OR ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
    );

-- The recorder takes a payment away, once its rows are gone; the other person
-- can only reject it. A user also clears one a shadow or guest recorded.
CREATE POLICY "payment_delete" ON "payment"
    AS PERMISSIVE FOR DELETE TO retrospend_app
    USING (
      (
        ("payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true))
        OR ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
      )
      AND ("recordedByType" <> 'user' OR "recordedById" = current_setting('app.current_user_id', true))
      AND NOT payment_has_rows("id")
    );

-- ------------------------------------------------------------
-- audit_log_entry: your own name; the SETTLED entry of a payment only from the
-- person who confirmed it; the system's only for the AUTO_VERIFIED entry of
-- your own auto-accepted split; the recorder's name only on the CREATED entry
-- of a row that has none.
-- ------------------------------------------------------------

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
            OR settlement_confirmed_by("targetId", current_setting('app.current_user_id', true))
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
-- Function privileges: the app role only.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION payment_recorded_by(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_has_rows(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_has_final_rows(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION currency_step(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_insert_ok(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, "SettlementStatus", BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_delete_ok(TEXT, TEXT, "SettlementStatus", TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_confirmed_by(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_created_for(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_group_check(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_group_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_group_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_guard_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_guard_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_recorded_by(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION payment_has_rows(TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION payment_has_final_rows(TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION currency_step(TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION settlement_insert_ok(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, "SettlementStatus", BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION settlement_delete_ok(TEXT, TEXT, "SettlementStatus", TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION settlement_confirmed_by(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION settlement_created_for(TEXT, TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION payment_group_check(TEXT, BOOLEAN) TO retrospend_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON "settlement" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment" TO retrospend_app;
