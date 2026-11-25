-- The phone's reset code (E2EE K3-5a; plan docs/roadmap/e2ee-k1-k3.md, "After
-- the critic" 2 and owner decision 4 C). A person on the phone asks for a
-- reset, gets an 8-character code by email, types it into the app and swaps it
-- for a recovery token that opens recovery with the recovery key and nothing
-- else. Both live in "password_reset_token", the one owner of reset secrets
-- (services/auth/reset-tokens.ts).
--
-- 1. "origin" gains two values. 'code' is the code's own row: it is never a
--    token a person sends, only something to compare a typed code against.
--    'phone' is the recovery token a redeemed code is swapped for: it opens
--    recovery like an 'email' link and never the plain password reset.
-- 2. "codeHash" holds the keyed hash of a code (the row's own "token" value,
--    the user id and the code under the server secret; keyed-hash.ts), so a
--    read of the table does not reveal a 40-bit code the way a plain SHA-256
--    would. It is set on a 'code' row and on no other, which the second
--    check enforces.
--
-- The table stays closed to retrospend_app (no grants, no row-level security):
-- only the owner connection reads and writes it. Additive and idempotent: the
-- origin check is widened, never narrowed, and a second run changes nothing.

ALTER TABLE "password_reset_token" ADD COLUMN IF NOT EXISTS "codeHash" TEXT;

ALTER TABLE "password_reset_token" DROP CONSTRAINT IF EXISTS "password_reset_token_origin_check";
ALTER TABLE "password_reset_token"
  ADD CONSTRAINT "password_reset_token_origin_check"
  CHECK ("origin" IN ('email', 'admin', 'phone', 'code'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_token_code_check') THEN
    ALTER TABLE "password_reset_token"
      ADD CONSTRAINT "password_reset_token_code_check"
      CHECK (("origin" = 'code') = ("codeHash" IS NOT NULL));
  END IF;
END $$;
