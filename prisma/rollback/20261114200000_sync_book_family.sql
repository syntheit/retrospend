-- Rollback for migration 20261114200000_sync_book_family. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261114200000_sync_book_family.sql
--
-- It drops the triggers on the twelve tables of the personal budget books
-- (and on "budget_member"), the functions they call, puts back the version of
-- sync_backfill() that 20261114100000_sync_change defined (nine tables), and
-- deletes the migration's row from "_prisma_migrations", so that starting this
-- release again applies the migration again (a roll forward) and
-- sync_backfill() rebuilds the stamps. It then runs sync_reset(): the older
-- image writes the book family without stamps, so every cursor a device holds
-- must be refused (410, a new epoch) or a row deleted in between would never
-- reach it as a tombstone. That also deletes the twelve tables' stamps and
-- rebuilds the nine tables'. It refuses to run when 20261114100000_sync_change
-- is already rolled back: run this file first and that one's snippet after.
-- Checked by src/server/services/sync/sync-book-migration.pg.test.ts and, through `prisma migrate deploy`, by src/test/migrations/owner-upgrade.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DO $$
BEGIN
  IF to_regclass('public.sync_change') IS NULL
     OR to_regclass('public.sync_state') IS NULL
     OR to_regprocedure('sync_backfill()') IS NULL
     OR to_regprocedure('sync_reset(text)') IS NULL THEN
    RAISE EXCEPTION 'the sync log (20261114100000_sync_change) is already rolled back: roll back 20261114200000_sync_book_family first'
      USING ERRCODE = 'invalid_object_definition';
  END IF;
END $$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'budget_book', 'envelope_group', 'envelope', 'envelope_category', 'budget_movement',
    'book_period', 'month_close', 'income_rule', 'income_rule_run', 'payoff_plan',
    'wealth_transfer', 'envelope_change', 'budget_member'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_ins', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_upd', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_del', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS sync_stamp_book_members();
DROP FUNCTION IF EXISTS sync_stamp_book_self();
DROP FUNCTION IF EXISTS sync_stamp_book_rows();
DROP FUNCTION IF EXISTS sync_book_stamp(text, text, text);
DROP FUNCTION IF EXISTS sync_book_tables();
DROP FUNCTION IF EXISTS sync_book_owner(text);

CREATE OR REPLACE FUNCTION sync_backfill() RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  t TEXT;
  n BIGINT;
  total BIGINT := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'expense', 'category', 'recurring_template', 'asset_account', 'asset_snapshot',
    'asset_history', 'account_leg', 'transfer', 'asset_rate_type'
  ] LOOP
    EXECUTE format(
      'INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
       SELECT %L, s."id", s."userId", ''U'', pg_current_xact_id(), nextval(%L), CURRENT_TIMESTAMP
       FROM (SELECT r."id", r."userId" FROM %I r JOIN "user" u ON u."id" = r."userId" ORDER BY r."id") s
       ON CONFLICT ("entity", "entityId", "userId") DO NOTHING',
      t, 'sync_change_seq', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  RETURN total;
END;
$$;

-- A new epoch, a log rebuilt for the nine tables, the family's stamps gone.
SELECT sync_reset();

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114200000_sync_book_family';
