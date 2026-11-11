-- The service actor for the instance key (E2EE lane D11, PR 3.1; plan
-- docs/roadmap/e2ee-d11-pr3.md section 1.4).
--
-- The app's global client runs on the owner connection with no per-request
-- actor: it serves public pages, guests, viewer links, better-auth, the
-- workers and boot. It reads the instance key as the service: an owner
-- connection transaction that sets app.instance_service = 'on' and never
-- drops to a role. The actor check accepts that before the user and guest
-- branches, only when the session's role setting is 'none' (no SET ROLE and
-- no set_config('role', ...) in force). Every scoped query and every
-- userTransaction sets role to retrospend_app, so the flag is refused there
-- (28000) even if it is set by mistake. The check is positive: any role at
-- all is refused, not just retrospend_app.
--
-- Honest limit: app connections sign in as the owner and enter the app role
-- with a transaction-local set_config, so code running as retrospend_app could
-- RESET ROLE and then set the flag. This stops accidental reach, at the same
-- strength as the user actor (which retrospend_app can already set to any id);
-- it is no boundary against a hostile owner-connection process, which holds
-- the master key anyway.
--
-- current_setting('role') inside a SECURITY DEFINER function reads the
-- session's role setting, not the definer (pinned by a test in
-- src/server/services/keys/instance-key-service-actor.pg.test.ts).
--
-- Same signature, owner, search_path and grants as before (CREATE OR REPLACE
-- keeps the ACL; the REVOKEs below restate it), so prisma/grants/app-role.sql
-- and the privilege ratchet do not change. Idempotent. Rollback:
-- prisma/rollback/20261111200000_instance_key_service_actor.sql.

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

REVOKE ALL ON FUNCTION keystore."require_instance_actor"() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    REVOKE ALL ON FUNCTION keystore."require_instance_actor"() FROM retrospend_app;
  END IF;
END $$;
