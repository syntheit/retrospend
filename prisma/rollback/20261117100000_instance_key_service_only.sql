-- Rollback for migration 20261117100000_instance_key_service_only. Not a
-- migration: Prisma never runs this file. Migrations run on container start,
-- so an image rollback cannot undo that migration; run this by hand, as the
-- role that owns the keystore schema (the one that ran the migrations),
-- against the database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261117100000_instance_key_service_only.sql
--
-- It puts back what an app release from before that migration needs: the
-- actor check with its user and guest branches (and the service branch of
-- 20261111200000), the mint function without the epoch refusal, and EXECUTE
-- for retrospend_app on keystore.instance_text_keys and
-- keystore.create_first_instance_key. Checked by
-- src/server/services/keys/instance-key-service-only.pg.test.ts. A release
-- that has this migration's start check does not need it. Run
-- prisma/grants/app-role.sql afterwards only from a release that matches the
-- database; the newer file takes the two grants away again.
-- Idempotent: running it twice changes nothing more.

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
  IF pg_catalog.current_setting('app.instance_service', true) = 'on'
     AND pg_catalog.current_setting('role', true) = 'none' THEN
    RETURN;
  END IF;
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
    FROM public."app_settings" s WHERE s."id" = 'app_settings_singleton';
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

REVOKE ALL ON FUNCTION keystore."instance_text_keys"() FROM PUBLIC;
REVOKE ALL ON FUNCTION keystore."create_first_instance_key"(text, bigint) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    GRANT EXECUTE ON FUNCTION keystore."instance_text_keys"() TO retrospend_app;
    GRANT EXECUTE ON FUNCTION keystore."create_first_instance_key"(text, bigint) TO retrospend_app;
  END IF;
END $$;
