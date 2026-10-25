-- Fix: any user could insert a share for themselves into ANY expense whose id
-- they knew.
--
-- split_participant_access (20260326000000) was one FOR ALL policy whose WITH
-- CHECK began with "this row is my own share". That let a user insert, or move
-- one of their rows onto, a split of an expense they have nothing to do with:
-- the expense then became readable to them (is_split_participant) and their
-- share counted in the creator's balances. The same clause, plus the project
-- member check, let any project member, even a viewer, write every split row
-- of the project.
--
-- Now, per command:
--   SELECT  unchanged: your own row, an expense you own, or a project you are in.
--   INSERT  only the expense's creator or a project organizer/editor (the
--           app's assertCanModifyTransaction rule), or the person restoring a
--           share they removed themselves in the last 24 hours (the remove-me
--           undo, which inserts as the removed user before the expense is
--           visible to them again). That path is proven by the audit entry the
--           removal wrote: the same user, this expense, this share id.
--   UPDATE  the creator or a project organizer/editor; or the person a row
--           belongs to, who may change it only while it stays their own row on
--           an expense they are already on (accept, reject, category, unseen).
--   DELETE  the creator or a project organizer/editor, or the person a row
--           belongs to (remove me).
--
-- The payer is not enough on its own: the app lets only the creator and project
-- organizers/editors change an expense. Guests, claims, user deletion and the
-- audit sweeps use the owner connection, which RLS does not apply to.

-- Whether the user may write the split rows of an expense. SECURITY DEFINER so
-- the check does not recurse through shared_transaction's own policy (the same
-- pattern as is_transaction_owner).
CREATE OR REPLACE FUNCTION can_write_transaction_splits(p_transaction_id TEXT, p_user_id TEXT)
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
        (st."createdByType" = 'user' AND st."createdById" = p_user_id)
        OR (
          st."projectId" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "project_participant" pp
            WHERE pp."projectId" = st."projectId"
              AND pp."participantType" = 'user'
              AND pp."participantId" = p_user_id
              AND pp."role"::text IN ('ORGANIZER', 'EDITOR')
          )
        )
      )
  )
$$;

DROP POLICY IF EXISTS "split_participant_access" ON "split_participant";
DROP POLICY IF EXISTS "split_participant_select" ON "split_participant";
DROP POLICY IF EXISTS "split_participant_insert" ON "split_participant";
DROP POLICY IF EXISTS "split_participant_update" ON "split_participant";
DROP POLICY IF EXISTS "split_participant_delete" ON "split_participant";

CREATE POLICY "split_participant_select" ON "split_participant"
    AS PERMISSIVE FOR SELECT TO retrospend_app
    USING (
      ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
      OR is_transaction_owner("transactionId", current_setting('app.current_user_id', true))
      OR is_transaction_project_participant("transactionId", current_setting('app.current_user_id', true))
    );

CREATE POLICY "split_participant_insert" ON "split_participant"
    AS PERMISSIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      can_write_transaction_splits("transactionId", current_setting('app.current_user_id', true))
      OR (
        "participantType" = 'user'
        AND "participantId" = current_setting('app.current_user_id', true)
        AND EXISTS (
          SELECT 1 FROM "audit_log_entry" a
          WHERE a."actorType" = 'user'
            AND a."actorId" = current_setting('app.current_user_id', true)
            AND a."action" = 'PARTICIPANT_REMOVED'
            AND a."targetType" = 'SPLIT_PARTICIPANT'
            AND a."targetId" = "split_participant"."transactionId"
            AND a."timestamp" > now() - interval '24 hours'
            AND a."changes"->>'selfRemoved' = 'true'
            AND a."changes"->'removedSplitIds' @> to_jsonb("split_participant"."id")
        )
      )
    );

-- The own-row branch of WITH CHECK needs the row to stay on an expense the user
-- is already on. The helper reads the statement's snapshot, so for a row moved
-- to another expense it sees no share there and refuses.
CREATE POLICY "split_participant_update" ON "split_participant"
    AS PERMISSIVE FOR UPDATE TO retrospend_app
    USING (
      can_write_transaction_splits("transactionId", current_setting('app.current_user_id', true))
      OR ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      can_write_transaction_splits("transactionId", current_setting('app.current_user_id', true))
      OR (
        "participantType" = 'user'
        AND "participantId" = current_setting('app.current_user_id', true)
        AND is_split_participant("transactionId", current_setting('app.current_user_id', true))
      )
    );

CREATE POLICY "split_participant_delete" ON "split_participant"
    AS PERMISSIVE FOR DELETE TO retrospend_app
    USING (
      can_write_transaction_splits("transactionId", current_setting('app.current_user_id', true))
      OR ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "split_participant" TO retrospend_app;

-- Sibling: shared_transaction accepted an INSERT for any row the user paid for,
-- so a user could plant an expense "created by" someone else, or into a project
-- they are not in. A new expense is created by its author, in a project the
-- author belongs to. Restrictive, so it narrows shared_transaction_access for
-- inserts only; updates and reads are untouched.
DROP POLICY IF EXISTS "shared_transaction_insert_author" ON "shared_transaction";
CREATE POLICY "shared_transaction_insert_author" ON "shared_transaction"
    AS RESTRICTIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      "createdByType" = 'user'
      AND "createdById" = current_setting('app.current_user_id', true)
      AND (
        "projectId" IS NULL
        OR EXISTS (
          SELECT 1 FROM "project_participant" pp
          WHERE pp."projectId" = "shared_transaction"."projectId"
            AND pp."participantType" = 'user'
            AND pp."participantId" = current_setting('app.current_user_id', true)
        )
      )
    );
