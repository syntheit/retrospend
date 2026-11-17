-- The instance key's user and guest doors go (encryption review 2026-11-17,
-- area 4, R3). Every production caller reads and mints the instance key as the
-- service actor on the owner connection (20261111200000_instance_key_service_actor):
-- the global client, the seal path's first write, the contact hash and the
-- flag-on start. Nothing production-side calls it as a user or a guest, so
-- those two actors, and the EXECUTE grants that let retrospend_app call the
-- key doors at all, were doors nobody used. One of them was a hole: before the
-- epoch, SQL running as retrospend_app could set app.current_user_id, call
-- keystore.create_first_instance_key('junk', 1) and plant a key the master key
-- cannot open, which also set "instanceKeySince" and stopped the next flag-on
-- start with master_key_mismatch.
--
-- This migration:
--   1. keystore.require_instance_actor keeps only the service branch (the
--      owner connection, app.instance_service = 'on', session role 'none');
--   2. retrospend_app loses EXECUTE on keystore.instance_text_keys and
--      keystore.create_first_instance_key (prisma/grants/app-role.sql says the
--      same, so a restore and every start end in this state);
--   3. keystore.create_first_instance_key also raises KS001 when the field
--      encryption epoch is set and no key row exists. The epoch is written
--      after the first mint, so a mint after it can only follow a lost keystore
--      whose "instanceKeySince" marker was cleared by hand, and a new key would
--      open nothing sealed before.
--
-- Same signatures, owner and search_path as before; CREATE OR REPLACE keeps the
-- owner. Idempotent. Rollback:
-- prisma/rollback/20261117100000_instance_key_service_only.sql.

CREATE OR REPLACE FUNCTION keystore."require_instance_actor"()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('app.instance_service', true) = 'on'
     AND pg_catalog.current_setting('role', true) = 'none' THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'keystore: the instance key is for the service only' USING ERRCODE = '28000';
END
$$;

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
  epoch timestamp(3);
BEGIN
  PERFORM keystore."require_instance_actor"();
  INSERT INTO public."app_settings" ("id", "updatedAt")
  VALUES ('app_settings_singleton', pg_catalog.now() AT TIME ZONE 'UTC')
  ON CONFLICT ("id") DO NOTHING;
  SELECT s."instanceKeySince", s."fieldEncryptionSince" INTO since, epoch
    FROM public."app_settings" s WHERE s."id" = 'app_settings_singleton';
  IF (since IS NOT NULL OR epoch IS NOT NULL)
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
    REVOKE ALL ON FUNCTION keystore."instance_text_keys"() FROM retrospend_app;
    REVOKE ALL ON FUNCTION keystore."create_first_instance_key"(text, bigint) FROM retrospend_app;
  END IF;
END $$;
