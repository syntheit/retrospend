-- Per-user data keys for server-side field encryption (E2EE spike lane D2).
--
-- The keys live in their own schema so the sidecar can leave them out of the
-- main dump and back them up alone with a short retention. Each key is stored
-- sealed under the server master key (src/server/crypto/master-key.ts), so a
-- database dump alone cannot open it. Nothing encrypts user data yet.
--
-- Access decision: retrospend_app has no privilege on the table, and RLS is
-- enabled with no policy as a second lock. It reaches its own key only through
-- two SECURITY DEFINER functions below, which bind to the signed-in user: they
-- read app.current_user_id, the setting the user-scoped client sets inside its
-- transaction (src/server/db.ts, src/server/db-tx.ts), and refuse when it is
-- empty. A caller cannot name another user as an argument. EXECUTE goes to
-- retrospend_app only. retrospend_app does get USAGE on this schema, which
-- Postgres requires to call a function in it; USAGE alone opens no table.
-- Work with no user in scope (account deletion, master key rotation) uses the
-- owner connection: see src/server/services/keys.

CREATE SCHEMA IF NOT EXISTS keystore;

REVOKE ALL ON SCHEMA keystore FROM PUBLIC;

-- "keyId" names the key version; a user's first key is 1. "wrappedKey" is the
-- data key sealed by sealField (AES-256-GCM, AAD binds table, column and
-- "userId:keyId"), so a wrapped key copied to another user or version fails to
-- open. "masterKeyId" repeats the master key id from the sealed header so the
-- rewrap job (D12) can find rows without opening them; BIGINT because a master
-- key id may be up to 4294967295.
--
-- There is no foreign key to "user" on purpose: a restore of the main dump
-- (which leaves this schema out) drops and recreates "user", and a foreign key
-- from another schema would block that. The trigger below does the cascade.
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

CREATE INDEX IF NOT EXISTS "user_data_key_masterKeyId_idx"
  ON keystore."user_data_key"("masterKeyId");

ALTER TABLE keystore."user_data_key" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA keystore FROM retrospend_app;
  END IF;
END $$;

-- The two doors for a signed-in user. Both pin search_path to pg_catalog (pg_temp last) and
-- name every object in full; the owner is whoever runs the migration.
-- create_first_data_key locks the user row (FOR KEY SHARE) so a user deleted at
-- the same moment cannot be left with a key: the delete waits for this
-- transaction and its trigger then sees the new key.
CREATE OR REPLACE FUNCTION keystore."current_user_data_keys"()
RETURNS TABLE ("user_id" text, "key_id" integer, "wrapped_key" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  uid text := nullif(pg_catalog.current_setting('app.current_user_id', true), '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'keystore: no signed-in user' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
    SELECT k."userId", k."keyId", k."wrappedKey"
    FROM keystore."user_data_key" k
    WHERE k."userId" = uid
    ORDER BY k."keyId" DESC;
END
$$;

CREATE OR REPLACE FUNCTION keystore."create_first_data_key"(
  "p_wrapped_key" text,
  "p_master_key_id" bigint
)
RETURNS TABLE ("user_id" text, "key_id" integer, "wrapped_key" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  uid text := nullif(pg_catalog.current_setting('app.current_user_id', true), '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'keystore: no signed-in user' USING ERRCODE = '28000';
  END IF;
  PERFORM 1 FROM public."user" u WHERE u."id" = uid FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'keystore: no such user' USING ERRCODE = '28000';
  END IF;
  INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId")
  VALUES (uid, 1, "p_wrapped_key", "p_master_key_id")
  ON CONFLICT ("userId", "keyId") DO NOTHING;
  RETURN QUERY SELECT * FROM keystore."current_user_data_keys"();
END
$$;

REVOKE ALL ON FUNCTION keystore."current_user_data_keys"() FROM PUBLIC;
REVOKE ALL ON FUNCTION keystore."create_first_data_key"(text, bigint) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    GRANT USAGE ON SCHEMA keystore TO retrospend_app;
    GRANT EXECUTE ON FUNCTION keystore."current_user_data_keys"() TO retrospend_app;
    GRANT EXECUTE ON FUNCTION keystore."create_first_data_key"(text, bigint) TO retrospend_app;
  END IF;
END $$;

-- A user's keys go in the same transaction as the user row, whoever deletes it
-- and whichever role they run as (retrospend_app has no access to the
-- keystore table, hence SECURITY DEFINER). The function lives in public so it is in
-- the main dump with the trigger; to_regclass keeps a user delete working when
-- the keystore is missing, for example after restoring a main dump into a new
-- database before the keystore dump. Restoring "user" does not fire it.
CREATE OR REPLACE FUNCTION public."keystore_drop_user_keys"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF to_regclass('keystore.user_data_key') IS NOT NULL THEN
    DELETE FROM keystore."user_data_key" WHERE "userId" = OLD."id";
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public."keystore_drop_user_keys"() FROM PUBLIC;

DROP TRIGGER IF EXISTS "keystore_user_delete" ON public."user";
CREATE TRIGGER "keystore_user_delete"
  AFTER DELETE ON public."user"
  FOR EACH ROW EXECUTE FUNCTION public."keystore_drop_user_keys"();
