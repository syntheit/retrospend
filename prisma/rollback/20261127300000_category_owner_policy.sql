-- Rollback for migration 20261127300000_category_owner_policy. Not a
-- migration: Prisma never runs this file. Migrations run on container start, so
-- an image rollback cannot undo that migration; run this by hand, as the role
-- that owns the tables (the one that ran the migrations), before starting the
-- older image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261127300000_category_owner_policy.sql
--
-- It puts back the policy and the function of 20260326000002 and drops
-- categories_shown_to and category_shown_on_split: category_isolation
-- FOR ALL with the shared-expense clause in USING (a person on a split can
-- delete or take over the owner's category again), the broader function, and
-- no category_shared_read. It deletes only this migration's row from
-- "_prisma_migrations", so starting this release again applies the migration
-- again. It touches nothing of 20261127200000_category_version. Checked by
-- src/test/migrations/category-owner-policy.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

CREATE OR REPLACE FUNCTION is_category_in_user_shared_transaction(p_category_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "shared_transaction" st
    INNER JOIN "split_participant" sp ON sp."transactionId" = st."id"
    WHERE st."categoryId" = p_category_id
      AND sp."participantType" = 'user'
      AND sp."participantId" = p_user_id
  )
$$;

DROP POLICY IF EXISTS category_shared_read ON "category";
DROP POLICY IF EXISTS category_isolation ON "category";
CREATE POLICY category_isolation ON "category"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (
    "userId" = current_setting('app.current_user_id', TRUE)
    OR is_category_in_user_shared_transaction("id", current_setting('app.current_user_id', TRUE))
  )
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT EXECUTE ON FUNCTION is_category_in_user_shared_transaction(TEXT, TEXT) TO retrospend_app;

DROP FUNCTION IF EXISTS categories_shown_to(TEXT);
DROP FUNCTION IF EXISTS category_shown_on_split(TEXT, TEXT);

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127300000_category_owner_policy';
