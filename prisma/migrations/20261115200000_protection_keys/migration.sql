-- What a client needs to unlock Advanced protection and nothing the server
-- can use itself (E2EE F6a): the Argon2id salt and parameters, the account
-- public key and every wrapped key. Ciphertext and public values only, never
-- user text, so nothing here is sealed.
--
-- 1. "protection_key_set": one row per user. "version" covers the whole set:
--    every change to it or to any of its wraps bumps it, and a writer names
--    the version it read (optimistic concurrency between devices). The Argon2
--    floor is checked in the service so that raising it needs no migration;
--    only the ceiling a phone must never be asked past is pinned here.
-- 2. "protection_key_wrap": one row per wrapped key. "role" is text, not an
--    enum (Prisma enum values cannot hold "-", and ALTER TYPE ADD VALUE is
--    awkward later). The CHECKs pin the wrap formats of packages/crypto
--    (keys.ts: 01 01 and 74 bytes for the symmetric roles, 01 02 and 98 for
--    the two sealed ones), so a format change needs a migration on purpose.
--    The id bound into a wrap's AAD is "targetId": the user id for the AK and
--    private key wraps, the key id, device id or contact id otherwise.
--
-- Row-level security is ENABLE, not FORCE: the owner writes these tables too
-- (password change and enabling protection write the key set with the
-- password hash on the owner connection), so the owner must keep bypassing
-- the policy, as on sync_change and most tables. Only retrospend_app is bound
-- by it, to the caller's own rows.
--
-- Grants are the narrowest a user-scoped path uses. The key set is never
-- deleted by the app role and its public key and owner never change. A wrap
-- is replaced (delete then insert), never edited, so it has no UPDATE.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "protection_key_set" (
  "userId"       TEXT         NOT NULL,
  "kdfSalt"      BYTEA        NOT NULL,
  "kdfMemoryKiB" INTEGER      NOT NULL,
  "kdfPasses"    INTEGER      NOT NULL,
  "publicKey"    BYTEA        NOT NULL,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "protection_key_set_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "protection_key_set_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "protection_key_set_salt_check" CHECK (octet_length("kdfSalt") = 16),
  CONSTRAINT "protection_key_set_public_key_check" CHECK (octet_length("publicKey") = 32),
  CONSTRAINT "protection_key_set_memory_check" CHECK ("kdfMemoryKiB" BETWEEN 1 AND 262144),
  CONSTRAINT "protection_key_set_passes_check" CHECK ("kdfPasses" BETWEEN 1 AND 10),
  CONSTRAINT "protection_key_set_version_check" CHECK ("version" >= 1)
);

CREATE TABLE IF NOT EXISTS "protection_key_wrap" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "userId"    TEXT         NOT NULL,
  "role"      TEXT         NOT NULL,
  "targetId"  TEXT         NOT NULL,
  "wrapped"   BYTEA        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "protection_key_wrap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "protection_key_wrap_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "protection_key_wrap_role_check" CHECK ("role" IN (
    'ak-password', 'ak-recovery', 'private-key', 'collection-key', 'ak-device', 'ak-contact'
  )),
  CONSTRAINT "protection_key_wrap_target_check" CHECK ("targetId" ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- The wrapped key is the user's own: its AAD id is the user id.
  CONSTRAINT "protection_key_wrap_own_target_check" CHECK (
    "role" NOT IN ('ak-password', 'ak-recovery', 'private-key') OR "targetId" = "userId"
  ),
  -- substring is safe on a short value, where get_byte would raise.
  CONSTRAINT "protection_key_wrap_format_check" CHECK (
    ("role" IN ('ak-password', 'ak-recovery', 'private-key', 'collection-key')
       AND octet_length("wrapped") = 74 AND substring("wrapped" from 1 for 2) = '\x0101'::bytea)
    OR
    ("role" IN ('ak-device', 'ak-contact')
       AND octet_length("wrapped") = 98 AND substring("wrapped" from 1 for 2) = '\x0102'::bytea)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "protection_key_wrap_userId_role_targetId_key"
  ON "protection_key_wrap"("userId", "role", "targetId");

ALTER TABLE "protection_key_set" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS protection_key_set_own ON "protection_key_set";
CREATE POLICY protection_key_set_own ON "protection_key_set"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

ALTER TABLE "protection_key_wrap" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS protection_key_wrap_own ON "protection_key_wrap";
CREATE POLICY protection_key_wrap_own ON "protection_key_wrap"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT, INSERT ON "protection_key_set" TO retrospend_app;
GRANT UPDATE ("kdfSalt", "kdfMemoryKiB", "kdfPasses", "version", "updatedAt")
  ON "protection_key_set" TO retrospend_app;
GRANT SELECT, INSERT, DELETE ON "protection_key_wrap" TO retrospend_app;
