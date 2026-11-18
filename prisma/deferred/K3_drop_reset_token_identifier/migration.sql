-- K3: drop the address key of password reset links (E2EE K3-0).
--
-- NOT APPLIED. This folder sits outside prisma/migrations on purpose, so
-- `prisma migrate deploy` never runs it. Migration 20261118100000_reset_token_hardening
-- stopped writing "identifier" (a link resolves to its user id, never through an
-- address) and made it nullable; nothing reads it. Dropping it is a narrowing
-- change, so it waits until the owner schedules it.
--
-- To run it, once the owner schedules it:
--   1. The code that stopped writing "identifier" is live everywhere, and this
--      returns 0 (it can only hold links older than that release, an hour at most):
--        SELECT count(*) FROM "password_reset_token" WHERE "identifier" IS NOT NULL;
--   2. In the same release, remove "identifier" and the
--      @@unique([identifier, token]) line from PasswordResetToken in
--      prisma/schema.prisma, then run this as the table owner.
-- Idempotent.

DROP INDEX IF EXISTS "password_reset_token_identifier_token_key";
ALTER TABLE "password_reset_token" DROP COLUMN IF EXISTS "identifier";
