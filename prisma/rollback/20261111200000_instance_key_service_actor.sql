-- Rollback for migration 20261111200000_instance_key_service_actor. Not a
-- migration: Prisma never runs this file. Migrations run on container start,
-- so an image rollback cannot undo that migration; run this by hand, as the
-- role that owns the keystore schema (the one that ran the migrations),
-- against the database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261111200000_instance_key_service_actor.sql
--
-- It puts back the actor check of 20261111100000_instance_text_key, without
-- the service branch, checked by
-- src/server/services/keys/instance-key-service-actor.pg.test.ts. The grants
-- do not change (CREATE OR REPLACE keeps them). An app release from before the
-- service actor needs nothing else; a later one can no longer load the
-- instance key on its global client, which then reads plaintext only.
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
