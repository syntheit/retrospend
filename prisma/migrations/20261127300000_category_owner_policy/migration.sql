-- A category is written by its owner alone and read by the people on a split
-- expense filed under it.
--
-- category_isolation was FOR ALL with the shared-expense clause in USING, so a
-- person on a split could also DELETE the owner's category (USING only), which
-- cascades to the owner's Budget, EnvelopeCategory and
-- AnalyticsCategoryPreference rows, or UPDATE it to their own userId (the
-- WITH CHECK was satisfied by the new owner). Now:
--   * category_isolation: FOR ALL, owner only, USING and WITH CHECK.
--   * category_shared_read: FOR SELECT, the shared-expense clause.
-- Permissive policies combine per command, so SELECT is either, and INSERT,
-- UPDATE and DELETE are the owner's.
--
-- is_category_in_user_shared_transaction matched any split the person is on
-- that carries the category, so a category attached to a split by someone who
-- is not its owner showed its name to everyone on that split. It now needs the
-- category's owner to be a person the split is shown with (split_people): they
-- created it or are on it.
-- Nothing is rewritten: old rows that hold such a category stay, and are
-- simply not readable by the people the owner never shared with.
--
-- Grants are unchanged (retrospend_app keeps DELETE, INSERT, SELECT, UPDATE on
-- the table; the policies decide the rows). CREATE OR REPLACE keeps the
-- function's grants; the signature and the search_path pin are as before.

-- The one rule for where a category may be shown: on a split its owner created
-- or is a person on. It is written once, as this view of the users a split is
-- shown with; the function after it, the policy's K7 function and the public
-- page's totals all read it (the server readers that bypass row level security
-- ask the function, through category-shown.ts). A view, not a per-split
-- function call, so the policy's check stays one set-based query however many
-- splits a category is filed on. Owner only: nothing reaches it as
-- retrospend_app except through the definer functions that follow.
CREATE OR REPLACE VIEW split_people AS
  SELECT "id" AS split_id, "createdById" AS user_id
  FROM "shared_transaction"
  WHERE "createdByType" = 'user'
  UNION
  SELECT "transactionId", "participantId"
  FROM "split_participant"
  WHERE "participantType" = 'user';
REVOKE ALL ON "split_people" FROM PUBLIC, retrospend_app;

CREATE OR REPLACE FUNCTION category_shown_on_split(p_category_id TEXT, p_split_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "category" c
    INNER JOIN "split_people" sp ON sp.user_id = c."userId"
    WHERE c."id" = p_category_id
      AND sp.split_id = p_split_id
  )
$$;
REVOKE ALL ON FUNCTION category_shown_on_split(TEXT, TEXT) FROM PUBLIC, retrospend_app;

CREATE OR REPLACE FUNCTION is_category_in_user_shared_transaction(p_category_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "split_participant" me
    INNER JOIN "shared_transaction" st ON st."id" = me."transactionId"
    INNER JOIN "category" c ON c."id" = p_category_id
    INNER JOIN "split_people" sp ON sp.split_id = st."id" AND sp.user_id = c."userId"
    WHERE me."participantType" = 'user'
      AND me."participantId" = p_user_id
      AND st."categoryId" = p_category_id
  )
$$;

DROP POLICY IF EXISTS category_isolation ON "category";
CREATE POLICY category_isolation ON "category"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

DROP POLICY IF EXISTS category_shared_read ON "category";
CREATE POLICY category_shared_read ON "category"
  AS PERMISSIVE FOR SELECT TO retrospend_app
  USING (
    is_category_in_user_shared_transaction("id", current_setting('app.current_user_id', TRUE))
  );
