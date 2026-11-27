-- A category carries a version that moves when a device-editable column changes.
--
-- A device that edits a category offline names the version it read; the server
-- refuses the write (409 category_changed) when the category moved since.
-- Categories have no updatedAt to serve as that version, so they get a counter
-- of their own.
--
-- One BEFORE UPDATE row trigger owns the rule for color, icon and
-- excludeByDefault, so every writer is covered without a list to keep (the
-- default-category scripts included: a color fix parks a pending device edit,
-- which is correct). When one of them holds a different value than before and
-- the writer did not move the version itself, the version becomes OLD + 1.
-- A write that already moved it (the service's rename, "version" = "version"
-- + 1, in the same statement as a color change) is not doubled. A write that
-- LOWERS the version is refused: nothing may hold a version back.
--
-- The name is deliberately not read here. It is sealed text, and
-- encryption-at-rest backfills and key rotations rewrite its stored bytes
-- without changing the name; a reseal must never bump. A rename is versioned
-- by updateCategory, which increments the version in the same statement.
-- nameIndex, kind and isFixed are never read either.
--
-- The list lives in packages/domain/src/category-version.ts; the test
-- src/test/migrations/category-version.pg.test.ts reads it back from this
-- function and fails on a difference.
--
-- A plain BEFORE UPDATE, never "UPDATE OF": that fires on a column in the SET
-- list even with the same value. IS DISTINCT FROM compares values, nulls
-- included. INSERT keeps the version it is given (a restored category keeps
-- its own).
--
-- SECURITY INVOKER: it only reads OLD and writes NEW. It needs no EXECUTE for
-- retrospend_app (Postgres checks EXECUTE on a trigger function when the
-- trigger is created, not when it fires). The table-level grant on "category"
-- already covers the new column (prisma/grants/app-role.sql).
--
-- Rollback: prisma/rollback/20261127200000_category_version.sql.

ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION category_version_moves() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."version" < OLD."version" THEN
    RAISE EXCEPTION 'A category version cannot go down'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."color", NEW."icon", NEW."excludeByDefault")
     IS DISTINCT FROM
     (OLD."color", OLD."icon", OLD."excludeByDefault")
     AND NEW."version" <= OLD."version"
  THEN
    NEW."version" := OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "category_version_moves" ON "category";
CREATE TRIGGER "category_version_moves" BEFORE UPDATE ON "category"
  FOR EACH ROW EXECUTE FUNCTION category_version_moves();
