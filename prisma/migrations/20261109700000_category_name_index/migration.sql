-- A blind index for category names (E2EE lane D9). "nameIndex" holds a keyed
-- hash of the trimmed name (src/server/crypto/blind-index.ts), computed by the
-- app with the user's data key, so uniqueness keeps working once names are
-- ciphertext (docs/roadmap/e2ee-spike.md, section 3). It is NULL until the
-- backfill (scripts/backfill-category-name-index.ts) has run, and stays NULL
-- on an instance with no DATA_MASTER_KEY. The unique index is a plain one:
-- Postgres treats NULLs as distinct, so rows without an index never collide,
-- which is what a "WHERE nameIndex IS NOT NULL" partial index would give, and
-- Prisma can express this form in the schema (no drift to explain).
-- The old unique index "category_name_userId_key" stays until the owner
-- schedules its drop (prisma/deferred/D9_drop_category_name_unique).
-- Additive and idempotent: ADD COLUMN of a nullable column rewrites nothing,
-- and the unique index builds over a column that is all NULL, so it is quick
-- (a SHARE lock on category, once, at container start). A rerun skips both.
-- Grants: "category" is granted to retrospend_app as a whole table (not by
-- column), so the new column needs no grant changes in prisma/grants/app-role.sql
-- or the privilege ratchet, and RLS (category_isolation) covers it.

ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "nameIndex" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "category_userId_nameIndex_key"
  ON "category"("userId", "nameIndex");
