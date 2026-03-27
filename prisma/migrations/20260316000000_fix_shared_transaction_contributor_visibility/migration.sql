-- Fix: allow project participants to see all project data.
--
-- The original RLS policies only allowed access based on direct involvement
-- (payer, creator, split participant, settlement party, shadow owner). This
-- meant a project contributor who wasn't directly referenced on a record
-- could not see it, even though the app-layer expects all project members
-- to see all project data.
--
-- project_participant has a fully-permissive RLS policy (USING (true)) so
-- subqueries against it are safe from recursion.
--
-- Note: migration 20260305000005_fix_rls_recursion introduced SECURITY
-- DEFINER helpers (is_split_participant, is_transaction_owner) to break
-- the shared_transaction <-> split_participant circular RLS reference.
-- This migration continues that pattern and adds a new helper for the
-- project participant check.


-- ============================================================
-- Helper: check whether the given user is a project participant
-- for a transaction's project. SECURITY DEFINER bypasses RLS on
-- shared_transaction so split_participant's policy can call this
-- without triggering the cross-table recursion.
-- ============================================================

CREATE OR REPLACE FUNCTION is_transaction_project_participant(p_transaction_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "shared_transaction" st
    INNER JOIN "project_participant" pp ON pp."projectId" = st."projectId"
    WHERE st."id" = p_transaction_id
      AND st."projectId" IS NOT NULL
      AND pp."participantType" = 'user'
      AND pp."participantId" = p_user_id
  )
$$;


-- ============================================================
-- 1. shared_transaction: consolidate into one policy with
--    project participant access.
--
-- The DB currently has TWO active permissive policies:
--   - shared_transaction_payer_access (from 20260305000000)
--   - shared_transaction_access (from 20260305000005_fix_rls_recursion)
-- Drop both and replace with one consolidated policy.
-- ============================================================

DROP POLICY IF EXISTS "shared_transaction_payer_access" ON "shared_transaction";
DROP POLICY IF EXISTS "shared_transaction_access" ON "shared_transaction";
CREATE POLICY "shared_transaction_access" ON "shared_transaction"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("paidByType" = 'user' AND "paidById" = current_setting('app.current_user_id', true))
      OR ("createdByType" = 'user' AND "createdById" = current_setting('app.current_user_id', true))
      OR is_split_participant("id", current_setting('app.current_user_id', true))
      OR EXISTS (
        SELECT 1 FROM "project_participant" pp
        WHERE pp."projectId" = "shared_transaction"."projectId"
          AND pp."participantType" = 'user'
          AND pp."participantId" = current_setting('app.current_user_id', true)
      )
    )
    WITH CHECK (
      ("paidByType" = 'user' AND "paidById" = current_setting('app.current_user_id', true))
      OR ("createdByType" = 'user' AND "createdById" = current_setting('app.current_user_id', true))
    );


-- ============================================================
-- 2. split_participant: add project participant access
--
-- listExpenses includes splitParticipants as a Prisma relation,
-- which runs a separate query subject to this policy. Without
-- the project check, contributors see transactions but empty splits.
--
-- The WITH CHECK also needs the project check so editors/organizers
-- can modify splits on transactions they didn't create.
-- ============================================================

DROP POLICY IF EXISTS "split_participant_access" ON "split_participant";
CREATE POLICY "split_participant_access" ON "split_participant"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
      OR is_transaction_owner("transactionId", current_setting('app.current_user_id', true))
      OR is_transaction_project_participant("transactionId", current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      is_transaction_owner("transactionId", current_setting('app.current_user_id', true))
      OR is_transaction_project_participant("transactionId", current_setting('app.current_user_id', true))
    );


-- ============================================================
-- 3. settlement: add project participant access
--
-- fetchProjectTransactionsAndSettlements expects to see ALL
-- finalized settlements between project members, not just those
-- involving the current user. Settlement has no direct projectId,
-- so we check: both from/to parties and the current user share
-- a common project via project_participant.
-- ============================================================

DROP POLICY IF EXISTS "settlement_access" ON "settlement";
CREATE POLICY "settlement_access" ON "settlement"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      -- Direct party (from or to)
      ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
      OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
      -- Both parties and current user share a project
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
    )
    WITH CHECK (
      -- Only direct parties can create/modify settlements
      ("fromParticipantType" = 'user' AND "fromParticipantId" = current_setting('app.current_user_id', true))
      OR ("toParticipantType" = 'user' AND "toParticipantId" = current_setting('app.current_user_id', true))
    );


-- ============================================================
-- 4. shadow_profile: add project participant access
--
-- resolveParticipantNames and listExpenses name resolution use
-- ctx.db (user-scoped). Without this, shadow profiles created by
-- other project members show as "Unknown".
-- ============================================================

DROP POLICY IF EXISTS "shadow_profile_isolation" ON "shadow_profile";
CREATE POLICY "shadow_profile_isolation" ON "shadow_profile"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      -- Creator
      "createdById" = current_setting('app.current_user_id', true)
      -- Shadow is a participant in a project the current user is also in
      OR EXISTS (
        SELECT 1 FROM "project_participant" pp_self
        INNER JOIN "project_participant" pp_shadow
          ON pp_shadow."projectId" = pp_self."projectId"
        WHERE pp_self."participantType" = 'user'
          AND pp_self."participantId" = current_setting('app.current_user_id', true)
          AND pp_shadow."participantType" = 'shadow'
          AND pp_shadow."participantId" = "shadow_profile"."id"
      )
    )
    WITH CHECK (
      -- Only the creator can modify their shadow profiles
      "createdById" = current_setting('app.current_user_id', true)
    );
