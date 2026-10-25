-- Corrections, settlement locks, Ask to fix and the Forgive audit (2C.2,
-- MONEY-MOVES 1.11, 1.12). Placeholder timestamp: the orchestrator assigns the
-- final one at merge.
-- 1. shared_transaction."correctsId": a correction entry names the split it
--    corrects. It holds only the per-person difference (paid and shares, the
--    shares may be negative), so the original is never rewritten.
-- 2. shared_transaction."lockedByPaymentId": the payment that settled a split
--    and locked it. NULL for a split a period close locked. A trigger on
--    "payment" unlocks the splits a payment locked, and those of any later
--    payment between the same two people in its scopes, when it is deleted
--    (undo, not received, unforgive) or stops being final.
-- 3. lock_settled_splits(): the one way a party to a payment locks the splits it
--    settled. SECURITY DEFINER because the other person's split is theirs to
--    write; it checks the caller is a party and that the payment's other party
--    is on each split.
-- 4. fix_request: Ask to fix. The id is made by the client, "updatedAt" is its
--    version. Only the asker and the asked see a row.
-- 5. AuditAction values for forgive, corrections and fix requests.
-- Additive and idempotent: every statement can run twice.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'FORGIVEN' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'FORGIVEN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'UNFORGIVEN' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'UNFORGIVEN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CORRECTED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'CORRECTED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CORRECTION_UNDONE' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'CORRECTION_UNDONE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'FIX_REQUESTED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'FIX_REQUESTED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'FIX_ANSWERED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'FIX_ANSWERED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FixRequestStatus') THEN
    CREATE TYPE "FixRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'FIXED', 'CANCELLED');
  END IF;
END $$;

ALTER TABLE "shared_transaction" ADD COLUMN IF NOT EXISTS "correctsId" TEXT;
ALTER TABLE "shared_transaction" ADD COLUMN IF NOT EXISTS "lockedByPaymentId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_transaction_correctsId_fkey') THEN
    ALTER TABLE "shared_transaction"
      ADD CONSTRAINT "shared_transaction_correctsId_fkey"
      FOREIGN KEY ("correctsId") REFERENCES "shared_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "shared_transaction_correctsId_idx" ON "shared_transaction" ("correctsId");
CREATE INDEX IF NOT EXISTS "shared_transaction_lockedByPaymentId_idx" ON "shared_transaction" ("lockedByPaymentId");

-- Locks by settlement.
CREATE OR REPLACE FUNCTION lock_settled_splits(p_payment_id TEXT, p_transaction_ids TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me TEXT := current_setting('app.current_user_id', true);
  pay RECORD;
  locked INTEGER;
BEGIN
  -- The app sets the role per transaction (set_config('role', ...)), so that
  -- is what tells its sessions from an admin job, which RLS does not restrain.
  IF COALESCE(me, '') = '' AND COALESCE(current_setting('role', true), '') = 'retrospend_app' THEN
    RAISE EXCEPTION 'not a party to that payment' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(me, '') = '' THEN
    SELECT * INTO pay FROM "payment" p WHERE p."id" = p_payment_id AND p."status" = 'FINALIZED';
  ELSE
    SELECT * INTO pay FROM "payment" p
    WHERE p."id" = p_payment_id AND p."status" = 'FINALIZED'
      AND ((p."payerType" = 'user' AND p."payerId" = me)
        OR (p."payeeType" = 'user' AND p."payeeId" = me));
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not a party to that final payment' USING ERRCODE = '42501';
  END IF;
  UPDATE "shared_transaction" st
  SET "isLocked" = true, "lockedByPaymentId" = p_payment_id, "updatedAt" = CURRENT_TIMESTAMP
  WHERE st."id" = ANY (p_transaction_ids)
    AND st."isLocked" = false
    AND st."correctsId" IS NULL
    -- Only the scopes the payment paid into.
    AND EXISTS (
      SELECT 1 FROM "settlement" s
      WHERE s."paymentGroupId" = p_payment_id
        AND s."projectId" IS NOT DISTINCT FROM st."projectId"
    )
    AND (
      (st."paidByType" = pay."payerType" AND st."paidById" = pay."payerId"
        AND EXISTS (SELECT 1 FROM "split_participant" sp WHERE sp."transactionId" = st."id"
          AND sp."participantType" = pay."payeeType" AND sp."participantId" = pay."payeeId"))
      OR (st."paidByType" = pay."payeeType" AND st."paidById" = pay."payeeId"
        AND EXISTS (SELECT 1 FROM "split_participant" sp WHERE sp."transactionId" = st."id"
          AND sp."participantType" = pay."payerType" AND sp."participantId" = pay."payerId"))
    );
  GET DIAGNOSTICS locked = ROW_COUNT;
  RETURN locked;
END;
$$;

-- A payment that is gone or no longer final settles nothing. Its locks go, and
-- so do the locks of any later payment between the same two people in the
-- scopes it paid into: they counted this one, so the splits may be owed again.
-- The app locks again what is still settled (lockSettledSplits). Runs before a
-- delete (the rows of the payment may already be gone, then every scope is
-- released) and after a status change.
CREATE OR REPLACE FUNCTION release_payment_locks() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scoped BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM "settlement" s WHERE s."paymentGroupId" = OLD."id") INTO scoped;
  UPDATE "shared_transaction" st
  SET "isLocked" = false, "lockedByPaymentId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
  WHERE st."lockedByPaymentId" = OLD."id"
    OR (
      st."lockedByPaymentId" IN (
        SELECT p2."id" FROM "payment" p2
        WHERE p2."paidOn" >= OLD."paidOn"
          AND ((p2."payerType" = OLD."payerType" AND p2."payerId" = OLD."payerId"
                AND p2."payeeType" = OLD."payeeType" AND p2."payeeId" = OLD."payeeId")
            OR (p2."payerType" = OLD."payeeType" AND p2."payerId" = OLD."payeeId"
                AND p2."payeeType" = OLD."payerType" AND p2."payeeId" = OLD."payerId"))
      )
      AND (NOT scoped OR EXISTS (
        SELECT 1 FROM "settlement" s
        WHERE s."paymentGroupId" = OLD."id"
          AND s."projectId" IS NOT DISTINCT FROM st."projectId"
      ))
    );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS payment_release_locks_delete ON "payment";
CREATE TRIGGER payment_release_locks_delete
  BEFORE DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION release_payment_locks();

DROP TRIGGER IF EXISTS payment_release_locks_status ON "payment";
CREATE TRIGGER payment_release_locks_status
  AFTER UPDATE OF "status" ON "payment"
  FOR EACH ROW
  WHEN (OLD."status" = 'FINALIZED' AND NEW."status" <> 'FINALIZED')
  EXECUTE FUNCTION release_payment_locks();

-- Ask to fix.
CREATE TABLE IF NOT EXISTS "fix_request" (
  "id"              TEXT NOT NULL,
  "transactionId"   TEXT NOT NULL,
  "requestedByType" "ParticipantType" NOT NULL,
  "requestedById"   TEXT NOT NULL,
  "askedType"       "ParticipantType" NOT NULL,
  "askedId"         TEXT NOT NULL,
  "message"         TEXT,
  "reply"           TEXT,
  "status"          "FixRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answeredAt"      TIMESTAMP(3),
  "fixedById"       TEXT,
  CONSTRAINT "fix_request_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fix_request_transactionId_fkey') THEN
    ALTER TABLE "fix_request"
      ADD CONSTRAINT "fix_request_transactionId_fkey"
      FOREIGN KEY ("transactionId") REFERENCES "shared_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "fix_request_transactionId_status_idx" ON "fix_request" ("transactionId", "status");
CREATE INDEX IF NOT EXISTS "fix_request_askedType_askedId_status_idx" ON "fix_request" ("askedType", "askedId", "status");
CREATE INDEX IF NOT EXISTS "fix_request_requestedByType_requestedById_idx" ON "fix_request" ("requestedByType", "requestedById");

-- RLS: the asker and the asked, nobody else on the split. Either side writes
-- (the app decides which transitions each side may make).
ALTER TABLE "fix_request" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fix_request_access" ON "fix_request";
CREATE POLICY "fix_request_access" ON "fix_request"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("requestedByType" = 'user' AND "requestedById" = current_setting('app.current_user_id', true))
      OR ("askedType" = 'user' AND "askedId" = current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      ("requestedByType" = 'user' AND "requestedById" = current_setting('app.current_user_id', true))
      OR ("askedType" = 'user' AND "askedId" = current_setting('app.current_user_id', true))
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "fix_request" TO retrospend_app;
