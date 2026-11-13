-- A keyed hash of a contact address (E2EE lane D11, Revision 3, PR 3a; plan
-- docs/roadmap/e2ee-d11-rev3.md). "emailHash" holds "<16 hex tag>:<64 hex>",
-- made by src/server/services/keys/contact-hash.ts from the instance key, so a
-- ghost or a guest can still be found by address once the address itself is
-- ciphertext. Nothing is sealed here: the column is derived data, written by
-- the writers and by the start-up fill (field-encryption-start.ts), and never
-- leaves the server.
--
-- The plain "email" indexes stay: instances with no master key still look
-- rows up by address. Table-level grants and row level security are
-- unchanged (prisma/grants/app-role.sql). Additive and idempotent.

ALTER TABLE "shadow_profile" ADD COLUMN IF NOT EXISTS "emailHash" TEXT;
ALTER TABLE "guest_session" ADD COLUMN IF NOT EXISTS "emailHash" TEXT;

CREATE INDEX IF NOT EXISTS "shadow_profile_emailHash_idx" ON "shadow_profile"("emailHash");
CREATE INDEX IF NOT EXISTS "guest_session_emailHash_idx" ON "guest_session"("emailHash");
