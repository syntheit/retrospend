-- Per-user data keys for server-side field encryption (E2EE spike lane D2).
--
-- The keys live in their own schema so the sidecar can leave them out of the
-- main dump and back them up alone with a short retention. Each key is stored
-- sealed under the server master key (src/server/crypto/master-key.ts), so a
-- database dump alone cannot open it. Nothing encrypts user data yet.
--
-- Access decision: the app role retrospend_app gets NO access, not even USAGE
-- on the schema. User-scoped clients (createUserScopedDb) run as retrospend_app,
-- so a bug or an injected query in any user-facing path cannot read or list
-- keys. RLS by userId would not be enough on its own: the keys must also be
-- reachable for system work with no user in scope (account deletion destroys a
-- key, the sidecar dumps the schema). The only way in is
-- src/server/services/keys, which runs on the owner connection (the global db
-- client). RLS is enabled with no policy as a second lock: if a grant is ever
-- added by mistake, rows stay hidden until a policy is written on purpose.
-- This is a deliberate, narrow use of the global client; do not copy it for
-- ordinary user data.

CREATE SCHEMA IF NOT EXISTS keystore;

REVOKE ALL ON SCHEMA keystore FROM PUBLIC;

-- "keyId" names the key version; a user's first key is 1. "wrappedKey" is the
-- data key sealed by sealField (AES-256-GCM, AAD binds table, column and
-- "userId:keyId"), so a wrapped key copied to another user or version fails to
-- open. "masterKeyId" repeats the master key id from the sealed header so the
-- rewrap job (D12) can find rows without opening them; BIGINT because a master
-- key id may be up to 4294967295. The key row goes when the user does; D3
-- destroys it explicitly first.
CREATE TABLE IF NOT EXISTS keystore."user_data_key" (
  "userId"      TEXT          NOT NULL,
  "keyId"       INTEGER       NOT NULL,
  "wrappedKey"  TEXT          NOT NULL,
  "masterKeyId" BIGINT        NOT NULL,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_data_key_pkey" PRIMARY KEY ("userId", "keyId"),
  CONSTRAINT "user_data_key_keyId_check" CHECK ("keyId" >= 1),
  CONSTRAINT "user_data_key_masterKeyId_check" CHECK ("masterKeyId" BETWEEN 1 AND 4294967295)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_data_key_userId_fkey') THEN
    ALTER TABLE keystore."user_data_key"
      ADD CONSTRAINT "user_data_key_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES public."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "user_data_key_masterKeyId_idx"
  ON keystore."user_data_key"("masterKeyId");

ALTER TABLE keystore."user_data_key" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    REVOKE ALL ON SCHEMA keystore FROM retrospend_app;
    REVOKE ALL ON ALL TABLES IN SCHEMA keystore FROM retrospend_app;
  END IF;
END $$;
