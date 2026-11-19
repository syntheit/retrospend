-- Password reset links, hardened (E2EE K3-0; plan docs/roadmap/e2ee-k1-k3.md,
-- "After the critic" 2, owner decision 8). Until now a link was a raw token in
-- the table, found through the account's current address, and each request
-- deleted the pending link, so anyone who knew an address could cancel a reset.
--
-- 1. "token" now holds the SHA-256 of the link's token (hashToken, in
--    services/auth/reset-tokens.ts, the one owner). The raw token lives only in
--    the email or the admin's screen, so a read of this table opens nothing.
-- 2. "userId" (cascade) binds a link to the account, so an address change does
--    not move it to whoever takes the old address. "origin" says who made it:
--    'email' (the person asked) or 'admin'. An admin link never opens recovery.
-- 3. "identifier" (the address) is no longer written: NOT NULL goes, the column
--    stays until prisma/deferred/K3_drop_reset_token_identifier is scheduled.
-- 4. The pending links die once, here: they are an hour old at most, and a
--    person who just asked asks again. The DELETE runs only when "userId" is
--    not there yet, so a second run keeps the links made since.
--
-- The table stays closed to retrospend_app (no grants, no row-level security),
-- as before: only the owner connection reads and writes it.
-- Additive and idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'password_reset_token' AND column_name = 'userId'
  ) THEN
    DELETE FROM "password_reset_token";
  END IF;
END $$;

ALTER TABLE "password_reset_token" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "password_reset_token" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL;
ALTER TABLE "password_reset_token" ALTER COLUMN "identifier" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_token_userId_fkey') THEN
    ALTER TABLE "password_reset_token"
      ADD CONSTRAINT "password_reset_token_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_token_origin_check') THEN
    ALTER TABLE "password_reset_token"
      ADD CONSTRAINT "password_reset_token_origin_check"
      CHECK ("origin" IN ('email', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "password_reset_token_userId_idx" ON "password_reset_token"("userId");
