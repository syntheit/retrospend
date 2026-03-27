-- Fix: allow project participants to read categories used in shared transactions.
--
-- The category_isolation RLS policy only allows access to the category owner
-- (userId = current_user). When a shared transaction references another user's
-- category, project participants see null instead of the category name/color/icon.
--
-- This adds a read-only path: if a category is referenced by a shared_transaction
-- in a project where the current user is a participant, they can SELECT it.
-- WITH CHECK remains owner-only so no one can modify another user's categories.
--
-- Uses SECURITY DEFINER to bypass shared_transaction RLS within the helper,
-- following the same pattern as is_split_participant, is_transaction_owner, etc.

-- ============================================================
-- Helper: check whether a category is used by any shared transaction
-- in a project where the given user is a participant.
-- SECURITY DEFINER bypasses RLS on shared_transaction to avoid
-- cascading RLS evaluation.
-- ============================================================

CREATE OR REPLACE FUNCTION is_category_in_shared_project(p_category_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "shared_transaction" st
    INNER JOIN "project_participant" pp ON pp."projectId" = st."projectId"
    WHERE st."categoryId" = p_category_id
      AND st."projectId" IS NOT NULL
      AND pp."participantType" = 'user'
      AND pp."participantId" = p_user_id
  )
$$;

-- ============================================================
-- Update category_isolation: add shared-project read access
-- ============================================================

DROP POLICY IF EXISTS category_isolation ON "category";
CREATE POLICY category_isolation ON "category"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (
    "userId" = current_setting('app.current_user_id', TRUE)
    OR is_category_in_shared_project("id", current_setting('app.current_user_id', TRUE))
  )
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));
