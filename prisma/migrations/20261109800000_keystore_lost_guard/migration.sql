-- Refuse to make a second first key for a user whose keys were lost (E2EE D11
-- prep, design finding 4).
--
-- keystore.create_first_data_key (20261109100000_keystore) made a key 1
-- whenever the user had none. After a restore of the main dump without the
-- keystore dump, every user has none, so each would get a new key 1 that opens
-- nothing sealed with the old one, and every later write would use it. The
-- marker below lives in the main schema, so a main dump carries it while the
-- keystore dump does not:
--
--   user."dataKeySince"  when the user's first data key was made; NULL before.
--
-- create_first_data_key sets it with the insert. With the marker set and no
-- key row, it raises SQLSTATE KS001 instead of making one (the app maps it to
-- DataKeyError "keystore_lost", src/server/services/keys/data-key.service.ts).
-- A user that never had a key (marker NULL) still gets one. To make a new key
-- on purpose after a loss, an operator clears the marker on the owner
-- connection, see "Data key backups" in docs/self-hosting.md.
--
-- Users whose keys exist today get the marker from the oldest key's time.
--
-- retrospend_app gets no privilege on the new column, not even SELECT: only the
-- SECURITY DEFINER function below reads and writes it, as the table owner. The
-- app role's column grants on "user" are a list (20261109600000_least_privilege,
-- prisma/grants/app-role.sql), so a column added later is unreadable to it
-- until a migration grants it, and that is wanted here. Scoped reads of "user"
-- already name their columns (it cannot read pendingEmailToken either), so the
-- new column breaks none of them.
--
-- The function is replaced with the same security settings as before:
-- SECURITY DEFINER, search_path = pg_catalog, pg_temp, EXECUTE for
-- retrospend_app only. A user delete still waits for it (FOR KEY SHARE on the
-- user row) and the delete trigger still removes the key. A deleted user has
-- no row, so no marker is involved. Idempotent: every statement can run again.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dataKeySince" TIMESTAMP(3);

DO $$ BEGIN
  IF to_regclass('keystore.user_data_key') IS NOT NULL THEN
    UPDATE public."user" u
       SET "dataKeySince" = k."since"
      FROM (
        SELECT "userId", min("createdAt") AS "since"
          FROM keystore."user_data_key"
         GROUP BY "userId"
      ) k
     WHERE k."userId" = u."id" AND u."dataKeySince" IS NULL;
  END IF;
END $$;

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
  since timestamp(3);
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'keystore: no signed-in user' USING ERRCODE = '28000';
  END IF;
  SELECT u."dataKeySince" INTO since FROM public."user" u WHERE u."id" = uid FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'keystore: no such user' USING ERRCODE = '28000';
  END IF;
  IF since IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM keystore."user_data_key" k WHERE k."userId" = uid) THEN
    RAISE EXCEPTION 'keystore: the data keys of this user were made before and are gone'
      USING ERRCODE = 'KS001';
  END IF;
  INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId")
  VALUES (uid, 1, "p_wrapped_key", "p_master_key_id")
  ON CONFLICT ("userId", "keyId") DO NOTHING;
  UPDATE public."user" u
     SET "dataKeySince" = pg_catalog.now() AT TIME ZONE 'UTC'
   WHERE u."id" = uid AND u."dataKeySince" IS NULL;
  RETURN QUERY SELECT * FROM keystore."current_user_data_keys"();
END
$$;

REVOKE ALL ON FUNCTION keystore."create_first_data_key"(text, bigint) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    GRANT EXECUTE ON FUNCTION keystore."create_first_data_key"(text, bigint) TO retrospend_app;
  END IF;
END $$;
