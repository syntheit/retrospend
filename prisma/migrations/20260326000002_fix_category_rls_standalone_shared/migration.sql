-- Fix: allow split participants to read categories on standalone shared expenses.
--
-- The previous fix (20260316000001) only covered categories used in shared
-- transactions within a PROJECT. For standalone shared expenses (no project),
-- participants still couldn't see the creator's category due to RLS.
--
-- This replaces `is_category_in_shared_project` with a broader function
-- `is_category_in_user_shared_transaction` that checks if the category is
-- used by ANY shared transaction where the current user is a split participant,
-- regardless of whether it's in a project or standalone.

-- ============================================================
-- New helper: check whether a category is used by any shared
-- transaction where the given user is a split participant.
-- SECURITY DEFINER bypasses RLS to avoid cascading evaluation.
-- ============================================================

CREATE OR REPLACE FUNCTION is_category_in_user_shared_transaction(p_category_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "shared_transaction" st
    INNER JOIN "split_participant" sp ON sp."transactionId" = st."id"
    WHERE st."categoryId" = p_category_id
      AND sp."participantType" = 'user'
      AND sp."participantId" = p_user_id
  )
$$;

-- ============================================================
-- Update category_isolation: use the broader helper
-- ============================================================

DROP POLICY IF EXISTS category_isolation ON "category";
CREATE POLICY category_isolation ON "category"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (
    "userId" = current_setting('app.current_user_id', TRUE)
    OR is_category_in_user_shared_transaction("id", current_setting('app.current_user_id', TRUE))
  )
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

-- ============================================================
-- Clean up: drop the old project-only helper (no longer referenced)
-- ============================================================

DROP FUNCTION IF EXISTS is_category_in_shared_project(TEXT, TEXT);
