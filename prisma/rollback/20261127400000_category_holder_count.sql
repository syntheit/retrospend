-- Rollback for migration 20261127400000_category_holder_count. Not a
-- migration: Prisma never runs this file. Migrations run on container start, so
-- an image rollback cannot undo that migration; run this by hand, as the role
-- that owns the tables (the one that ran the migrations), before starting the
-- older image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261127400000_category_holder_count.sql
--
-- It drops the function the undo of a category create counts with (the older
-- image has no such undo and never calls it) and deletes only this migration's
-- row from "_prisma_migrations", so starting this release again applies the
-- migration again. It touches nothing of the earlier category migrations.
-- Checked by src/test/migrations/category-holder-count.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DROP FUNCTION IF EXISTS category_holder_count(TEXT, TEXT);

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127400000_category_holder_count';
