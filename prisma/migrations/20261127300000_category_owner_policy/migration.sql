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
-- is not its owner showed its name to everyone on that split. It now matches
-- only when the category's owner created that split or is a person on it.
-- Nothing is rewritten: old rows that hold such a category stay, and are
-- simply not readable by the people the owner never shared with.
--
-- Grants are unchanged (retrospend_app keeps DELETE, INSERT, SELECT, UPDATE on
-- the table; the policies decide the rows). CREATE OR REPLACE keeps the
-- function's grants; the signature and the search_path pin are as before.

CREATE OR REPLACE FUNCTION is_category_in_user_shared_transaction(p_category_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "shared_transaction" st
    INNER JOIN "category" c ON c."id" = st."categoryId"
    INNER JOIN "split_participant" me
      ON me."transactionId" = st."id"
     AND me."participantType" = 'user'
     AND me."participantId" = p_user_id
    WHERE st."categoryId" = p_category_id
      AND (
        (st."createdByType" = 'user' AND st."createdById" = c."userId")
        OR EXISTS (
          SELECT 1 FROM "split_participant" owner_share
          WHERE owner_share."transactionId" = st."id"
            AND owner_share."participantType" = 'user'
            AND owner_share."participantId" = c."userId"
        )
      )
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
