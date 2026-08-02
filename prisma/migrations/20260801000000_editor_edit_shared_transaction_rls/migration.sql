-- Fix: project EDITORs / ORGANIZERs cannot modify a shared expense they did not
-- create or pay for.
--
-- The app layer (assertCanModifyTransaction) already allows an EDITOR/ORGANIZER to
-- edit or delete any expense in their project (contributor = own only, viewer = none).
-- But the shared_transaction RLS WITH CHECK only permitted the payer or creator to
-- write, so an organizer's update was rejected by Postgres:
--   "new row violates row-level security policy for table shared_transaction".
--
-- Widen the WITH CHECK to also allow a project participant who is an ORGANIZER or
-- EDITOR. Role enforcement (contributor/viewer limits) stays in the app layer; RLS is
-- the outer data-isolation guard. The USING clause is unchanged (all project
-- participants can already read). split_participant/settlement policies already permit
-- project participants to write, so this closes the last gap.

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
      OR EXISTS (
        SELECT 1 FROM "project_participant" pp
        WHERE pp."projectId" = "shared_transaction"."projectId"
          AND pp."participantType" = 'user'
          AND pp."participantId" = current_setting('app.current_user_id', true)
          AND pp."role"::text IN ('ORGANIZER', 'EDITOR')
      )
    );
