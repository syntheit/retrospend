-- Rollback for migration 20261112200000_contact_hash. Not a migration: Prisma
-- never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261112200000_contact_hash.sql
--
-- It drops the two "emailHash" columns and their indexes, checked by
-- src/server/services/keys/contact-hash.pg.test.ts. The hashes are derived
-- from the addresses, which this does not touch: the start-up fill makes them
-- again. Do not run it once any address is sealed (a later PR): the hash is
-- then the only way to find that ghost or guest by address.
-- Idempotent: running it twice changes nothing more.

DROP INDEX IF EXISTS "shadow_profile_emailHash_idx";
DROP INDEX IF EXISTS "guest_session_emailHash_idx";
ALTER TABLE "shadow_profile" DROP COLUMN IF EXISTS "emailHash";
ALTER TABLE "guest_session" DROP COLUMN IF EXISTS "emailHash";
