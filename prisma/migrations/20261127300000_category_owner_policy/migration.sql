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
-- is not its owner showed its name to everyone on that split. The read policy
-- now needs the category's owner to have created the split or be a person on
-- it.
-- Nothing is rewritten: old rows that hold such a category stay, and are
-- simply not readable by the people the owner never shared with.
--
-- Grants on the table are unchanged (retrospend_app keeps DELETE, INSERT,
-- SELECT, UPDATE on it; the policies decide the rows). category_shown_on_split
-- is owner only; categories_shown_to is the one function the policy calls as
-- retrospend_app (definer-functions.json, prisma/grants/app-role.sql). The old
-- per-row is_category_in_user_shared_transaction is dropped: nothing uses it.

-- The rule for where a category may be shown: on a split its owner created or
-- is a person on. It is asked of one (category, split) pair here, by the
-- server readers that bypass row level security (through category-shown.ts)
-- and by the public page's totals. categories_shown_to below states the same
-- rule as a set for the read policy; src/test/migrations/
-- category-shown-agree.pg.test.ts fails if the two ever disagree. Owner only:
-- nothing reaches this one as retrospend_app.
CREATE OR REPLACE FUNCTION category_shown_on_split(p_category_id TEXT, p_split_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "shared_transaction" st
    INNER JOIN "category" c ON c."id" = p_category_id
    WHERE st."id" = p_split_id
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
REVOKE ALL ON FUNCTION category_shown_on_split(TEXT, TEXT) FROM PUBLIC, retrospend_app;

-- The categories the signed-in person (app.current_user_id; none set, none
-- shown) may read through the splits they are on: those filed
-- on a split the category's owner created or is a person on (the rule above, as
-- a set). A set, not a per-row check: the policy below reads it as one hashed subquery per
-- statement, so a query over thousands of shares asks it once. (The old
-- is_category_in_user_shared_transaction ran per category row; with the rule in
-- it, an order of magnitude slower on 10,000 shares.)
CREATE OR REPLACE FUNCTION categories_shown_to()
RETURNS SETOF TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT st."categoryId"
  FROM "split_participant" me
  INNER JOIN "shared_transaction" st ON st."id" = me."transactionId"
  INNER JOIN "category" c ON c."id" = st."categoryId"
  WHERE me."participantType" = 'user'
    AND me."participantId" = current_setting('app.current_user_id', TRUE)
    AND (
      (st."createdByType" = 'user' AND st."createdById" = c."userId")
      OR EXISTS (
        SELECT 1 FROM "split_participant" owner_share
        WHERE owner_share."transactionId" = st."id"
          AND owner_share."participantType" = 'user'
          AND owner_share."participantId" = c."userId"
      )
    )
$$;
REVOKE ALL ON FUNCTION categories_shown_to() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION categories_shown_to() TO retrospend_app;

DROP POLICY IF EXISTS category_isolation ON "category";
CREATE POLICY category_isolation ON "category"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

DROP POLICY IF EXISTS category_shared_read ON "category";
CREATE POLICY category_shared_read ON "category"
  AS PERMISSIVE FOR SELECT TO retrospend_app
  USING (
    "id" IN (SELECT categories_shown_to())
  );

-- Nothing uses the per-row check any more.
DROP FUNCTION IF EXISTS is_category_in_user_shared_transaction(TEXT, TEXT);
