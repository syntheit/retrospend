-- ============================================================
-- Fix: Infinite recursion in RLS policies between
--      shared_transaction <-> split_participant
--
-- The original policies cross-reference each other via EXISTS subqueries,
-- causing PostgreSQL to detect infinite recursion:
--   shared_transaction USING → EXISTS on split_participant
--   split_participant  USING → EXISTS on shared_transaction
--
-- Fix: introduce two SECURITY DEFINER helper functions that access each
-- table bypassing RLS, then use them in the respective policies.
-- ============================================================

-- Helper: check whether the given user is a split participant on a transaction.
-- SECURITY DEFINER bypasses RLS on split_participant so shared_transaction's
-- policy can call this without triggering split_participant's policy.
CREATE OR REPLACE FUNCTION is_split_participant(p_transaction_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "split_participant" sp
    WHERE sp."transactionId" = p_transaction_id
      AND sp."participantType" = 'user'
      AND sp."participantId" = p_user_id
  )
$$;

-- Helper: check whether the given user owns a shared transaction (paidBy or createdBy).
-- SECURITY DEFINER bypasses RLS on shared_transaction so split_participant's
-- policy can call this without triggering shared_transaction's policy.
CREATE OR REPLACE FUNCTION is_transaction_owner(p_transaction_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "shared_transaction" st
    WHERE st."id" = p_transaction_id
      AND (
        (st."paidByType" = 'user' AND st."paidById" = p_user_id)
        OR (st."createdByType" = 'user' AND st."createdById" = p_user_id)
      )
  )
$$;

-- Rebuild shared_transaction policy: replace the inline split_participant
-- EXISTS subquery with the non-recursive helper function.
DROP POLICY IF EXISTS "shared_transaction_access" ON "shared_transaction";
CREATE POLICY "shared_transaction_access" ON "shared_transaction"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("paidByType" = 'user' AND "paidById" = current_setting('app.current_user_id', true))
      OR ("createdByType" = 'user' AND "createdById" = current_setting('app.current_user_id', true))
      OR is_split_participant("id", current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      ("paidByType" = 'user' AND "paidById" = current_setting('app.current_user_id', true))
      OR ("createdByType" = 'user' AND "createdById" = current_setting('app.current_user_id', true))
    );

-- Rebuild split_participant policy: replace the inline shared_transaction
-- EXISTS subquery with the non-recursive helper function.
DROP POLICY IF EXISTS "split_participant_access" ON "split_participant";
CREATE POLICY "split_participant_access" ON "split_participant"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
      OR is_transaction_owner("transactionId", current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      is_transaction_owner("transactionId", current_setting('app.current_user_id', true))
    );
