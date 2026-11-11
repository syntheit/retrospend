-- The instance key for shared text (E2EE lane D11, PR 2; design
-- docs/roadmap/e2ee-d11-design.md section 3 and Revision 2 item 1).
--
-- Shared tables (shared expenses, people, projects, budget books) hold text
-- that more than one account reads, so it cannot sit under one user's data key.
-- It is sealed under one random 32-byte instance key, kept here in the keystore
-- schema, itself wrapped by the server master key (AAD binds table, column and
-- key id), so a database dump alone cannot open it and a master key rotation
-- only rewraps this row. Nothing seals with it yet.
--
-- Access decision: like the user data keys, retrospend_app has no privilege on
-- the table (RLS is on with no policy as a second lock) and reaches the key
-- through SECURITY DEFINER functions. They cannot bind to one user, because a
-- guest has none, so they require an ACTOR instead: either
--   app.current_user_id    naming a row of "user", or
--   app.guest_session_id   naming a live guest_session row (the same 90-day
--                          inactivity rule the guest procedures apply).
-- Anything else raises SQLSTATE 28000. This adds no real weakness over the
-- design's "role only" option: retrospend_app can already set any user id.
-- A viewer link has no actor yet; see the PR notes.
--
-- Markers in app_settings (main schema, so a main dump carries them and the
-- keystore dump does not; the app role has no privilege on app_settings):
--   "instanceKeySince"  when the instance key was first made. Set with no key
--                       row means the keystore was lost: the mint function
--                       raises KS001 instead of making a key that opens nothing
--                       sealed before (same idea as "user"."dataKeySince").
--   "masterKeyCanary"   a fixed text sealed under the master key, checked at
--                       start-up so a wrong DATA_MASTER_KEY stops the server
--                       (src/server/services/keys/master-canary.service.ts).
--
-- Idempotent: every statement can run again.

ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "instanceKeySince" TIMESTAMP(3);
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "masterKeyCanary" TEXT;

-- "keyId" names the key version; the first key is 1 and a rotation adds N+1
-- (older ids stay so old text opens). "wrappedKey" is the key sealed by
-- sealField with AAD keystore.instance_text_key / wrappedKey / "<keyId>".
-- "masterKeyId" is the master key id from the sealed header, for the rewrap job.
CREATE TABLE IF NOT EXISTS keystore."instance_text_key" (
  "keyId"       INTEGER       NOT NULL,
  "wrappedKey"  TEXT          NOT NULL,
  "masterKeyId" BIGINT        NOT NULL,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instance_text_key_pkey" PRIMARY KEY ("keyId"),
  CONSTRAINT "instance_text_key_keyId_check" CHECK ("keyId" >= 1),
  CONSTRAINT "instance_text_key_masterKeyId_check" CHECK ("masterKeyId" BETWEEN 1 AND 4294967295)
);

CREATE INDEX IF NOT EXISTS "instance_text_key_masterKeyId_idx"
  ON keystore."instance_text_key"("masterKeyId");

ALTER TABLE keystore."instance_text_key" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    REVOKE ALL ON keystore."instance_text_key" FROM retrospend_app;
  END IF;
END $$;

-- The actor check, shared by both doors. It runs as the owner, so it can read
-- "user" and guest_session, and nobody but the owner may call it.
CREATE OR REPLACE FUNCTION keystore."require_instance_actor"()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  uid text := nullif(pg_catalog.current_setting('app.current_user_id', true), '');
  gid text := nullif(pg_catalog.current_setting('app.guest_session_id', true), '');
BEGIN
  IF uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."user" u WHERE u."id" = uid) THEN
    RETURN;
  END IF;
  -- Guest sessions expire after 90 days without use (src/server/api/trpc.ts);
  -- lastActiveAt is stored in UTC.
  IF gid IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public."guest_session" g
        WHERE g."id" = gid
          AND g."lastActiveAt" > (pg_catalog.now() AT TIME ZONE 'UTC') - interval '90 days'
     ) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'keystore: no signed-in user or guest session' USING ERRCODE = '28000';
END
$$;

-- Newest key first, so the first row is the current key.
CREATE OR REPLACE FUNCTION keystore."instance_text_keys"()
RETURNS TABLE ("key_id" integer, "wrapped_key" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM keystore."require_instance_actor"();
  RETURN QUERY
    SELECT k."keyId", k."wrappedKey"
    FROM keystore."instance_text_key" k
    ORDER BY k."keyId" DESC;
END
$$;

-- Makes key 1 when there is none, and returns the keys either way. The
-- app_settings row is locked first (and made, with every column at its default,
-- when it does not exist yet), so two processes that start together mint one
-- at a time; the insert is also ON CONFLICT DO NOTHING, so the loser's key is
-- dropped and both read the winner's. The marker is set in the same
-- transaction as the key.
CREATE OR REPLACE FUNCTION keystore."create_first_instance_key"(
  "p_wrapped_key" text,
  "p_master_key_id" bigint
)
RETURNS TABLE ("key_id" integer, "wrapped_key" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  since timestamp(3);
BEGIN
  PERFORM keystore."require_instance_actor"();
  INSERT INTO public."app_settings" ("id", "updatedAt")
  VALUES ('app_settings_singleton', pg_catalog.now() AT TIME ZONE 'UTC')
  ON CONFLICT ("id") DO NOTHING;
  SELECT s."instanceKeySince" INTO since
    FROM public."app_settings" s WHERE s."id" = 'app_settings_singleton' FOR UPDATE;
  IF since IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM keystore."instance_text_key") THEN
    RAISE EXCEPTION 'keystore: the instance key was made before and is gone'
      USING ERRCODE = 'KS001';
  END IF;
  INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
  VALUES (1, "p_wrapped_key", "p_master_key_id")
  ON CONFLICT ("keyId") DO NOTHING;
  UPDATE public."app_settings" s
     SET "instanceKeySince" = pg_catalog.now() AT TIME ZONE 'UTC'
   WHERE s."id" = 'app_settings_singleton' AND s."instanceKeySince" IS NULL;
  RETURN QUERY SELECT * FROM keystore."instance_text_keys"();
END
$$;

REVOKE ALL ON FUNCTION keystore."require_instance_actor"() FROM PUBLIC;
REVOKE ALL ON FUNCTION keystore."instance_text_keys"() FROM PUBLIC;
REVOKE ALL ON FUNCTION keystore."create_first_instance_key"(text, bigint) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    REVOKE ALL ON FUNCTION keystore."require_instance_actor"() FROM retrospend_app;
    GRANT EXECUTE ON FUNCTION keystore."instance_text_keys"() TO retrospend_app;
    GRANT EXECUTE ON FUNCTION keystore."create_first_instance_key"(text, bigint) TO retrospend_app;
  END IF;
END $$;
