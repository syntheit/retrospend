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
--     INSERT  the recorder, who is one of the two people. Final at once only
--             when the recorder is the payee (money received) or the payee
--             cannot confirm (shadow, guest).
--     UPDATE  a party. Nobody changes the people, the currency, the id or the
--             recorder. The receiver moves the status (PROPOSED to FINALIZED or
--             REJECTED; FINALIZED back to PROPOSED when both agreed) and, with
--             that move, sets amount, rate, date and method. Note: any party.
--     DELETE  a party, once no settlement row is left (the foreign key would
--             otherwise cascade around the row rules).
--   settlement
--     SELECT  unchanged.
--     INSERT  a party, onto an existing payment of the same two people. The
--             recorder writes PROPOSED rows with only their own flag set, or
--             FINAL rows (with an auto-confirm reason) when the payee is the
--             recorder or cannot confirm. The receiver writes only what a
--             confirm with a new amount writes (final rows, payment pending)
--             or what the confirm undo puts back (claim rows, payment final).
--             Cash rows go payer to payee.
--     UPDATE  a party. People, amounts, currency, project, kind and rate never
--             change (trigger). Reminder, note and method may. Status moves as
--             on the payment; flags and dates move only with it.
--     DELETE  a party: a row that is pending or rejected; a final row the
--             recorder made final alone (void); a final row both agreed to, by
--             the receiver only (confirm undo).
--   audit_log_entry
--     INSERT  in your own name, or the system's. A SETTLED entry of a payment
--             only by its receiver, once it is final: it is what the confirm
--             undo restores from. Another party's name only on CREATED (the
--             receiver rewriting rows under the recorder's name).

-- ------------------------------------------------------------
-- Helpers. SECURITY DEFINER so a policy or trigger can read the payment
-- without going through its own policy; only the app role may call them.
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
  )
$$;

-- "type:id" of the person who recorded the payment; NULL when there is none.
CREATE OR REPLACE FUNCTION payment_recorder_key(p_payment_id TEXT)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p."recordedByType"::text || ':' || p."recordedById"
  FROM "payment" p WHERE p."id" = p_payment_id
$$;

CREATE OR REPLACE FUNCTION payment_has_rows(p_payment_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "settlement" s WHERE s."paymentGroupId" = p_payment_id)
$$;

-- A row of the payment became final without the other side (money received,
-- or paid to someone who cannot confirm).
CREATE OR REPLACE FUNCTION payment_has_auto_rows(p_payment_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "settlement" s
    WHERE s."paymentGroupId" = p_payment_id AND s."autoConfirmedReason" IS NOT NULL
  )
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
  p_is_offset BOOLEAN
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
  -- Cash goes from the payer to the payee; only an offset row goes back.
  IF NOT COALESCE(p_is_offset, FALSE) AND NOT (
    h."payerType"::text = p_from_type AND h."payerId" = p_from_id
  ) THEN
    RETURN FALSE;
  END IF;

  from_is_recorder := h."recordedByType"::text = p_from_type AND h."recordedById" = p_from_id;
  recorder_flag := CASE WHEN from_is_recorder THEN p_confirmed_payer ELSE p_confirmed_payee END;
  other_flag := CASE WHEN from_is_recorder THEN p_confirmed_payee ELSE p_confirmed_payer END;

  IF h."recordedByType" = 'user' AND h."recordedById" = p_user_id THEN
    -- The recorder: pending with only their flag, or final alone when the
    -- payee is the recorder or cannot confirm.
    IF p_status = 'PROPOSED' THEN
      RETURN p_reason IS NULL AND recorder_flag AND NOT other_flag;
    ELSIF p_status = 'FINALIZED' THEN
      RETURN p_reason IS NOT NULL AND recorder_flag AND (
        (h."payeeType" = 'user' AND h."payeeId" = p_user_id) OR h."payeeType" <> 'user'
      );
    END IF;
    RETURN FALSE;
  END IF;

  -- The other party rewrites rows in two cases only.
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
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_status IN ('PROPOSED', 'REJECTED') THEN TRUE
    WHEN p_reason IS NOT NULL THEN payment_recorded_by(p_payment_id, p_user_id)
    ELSE EXISTS (SELECT 1 FROM "payment" p WHERE p."id" = p_payment_id)
         AND NOT payment_recorded_by(p_payment_id, p_user_id)
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
  recorder TEXT := payment_recorder_key(OLD."paymentGroupId");
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
    legal := NOT payment_has_auto_rows(OLD."id");
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
        "autoConfirmedReason", "isOffset"
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
        "status" = 'PROPOSED'
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

CREATE POLICY "payment_delete" ON "payment"
    AS PERMISSIVE FOR DELETE TO retrospend_app
    USING (
      (
        ("payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true))
        OR ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
      )
      AND NOT payment_has_rows("id")
    );

-- ------------------------------------------------------------
-- audit_log_entry: your own name or the system's; the SETTLED entry of a
-- payment only from the person who confirmed it; another party's name only on
-- CREATED.
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
          AND NOT ("targetType" = 'SETTLEMENT' AND "action" = 'SETTLED')
        )
        -- Confirming a payment with a new amount rewrites the rows and records
        -- them (CREATED) under the person who first recorded them: the other
        -- party of a settlement the user is also a party to.
        OR (
          "targetType" = 'SETTLEMENT'
          AND "action" = 'CREATED'
          AND EXISTS (
            SELECT 1 FROM "settlement" s
            WHERE s."id" = "audit_log_entry"."targetId"
              AND (
                (s."fromParticipantType" = 'user' AND s."fromParticipantId" = current_setting('app.current_user_id', true))
                OR (s."toParticipantType" = 'user' AND s."toParticipantId" = current_setting('app.current_user_id', true))
              )
              AND (
                (s."fromParticipantType" = 'user' AND s."fromParticipantId" = "audit_log_entry"."actorId")
                OR (s."toParticipantType" = 'user' AND s."toParticipantId" = "audit_log_entry"."actorId")
              )
          )
        )
      )
    );

-- ------------------------------------------------------------
-- Function privileges: the app role only.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION payment_recorded_by(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_recorder_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_has_rows(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_has_auto_rows(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_insert_ok(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, "SettlementStatus", BOOLEAN, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_delete_ok(TEXT, TEXT, "SettlementStatus", TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_confirmed_by(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement_guard_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION payment_guard_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_recorded_by(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION payment_recorder_key(TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION payment_has_rows(TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION payment_has_auto_rows(TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION settlement_insert_ok(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, "SettlementStatus", BOOLEAN, BOOLEAN, TEXT, BOOLEAN) TO retrospend_app;
GRANT EXECUTE ON FUNCTION settlement_delete_ok(TEXT, TEXT, "SettlementStatus", TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION settlement_confirmed_by(TEXT, TEXT) TO retrospend_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON "settlement" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment" TO retrospend_app;
