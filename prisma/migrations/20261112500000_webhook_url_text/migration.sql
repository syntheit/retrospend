-- Widen webhook.url to TEXT (E2EE lane D11, Revision 3 PR 2).
-- The url is mapped in the field map (src/server/crypto/fields.ts) as an
-- instance-class cell, because the worker reads it on the global client. A
-- sealed value of a 2048 character url is up to 4 * 2048 + 48 characters, which
-- a VarChar(2048) rejects on the first sealed write. VarChar(n) to TEXT keeps
-- the same storage and takes no table rewrite. Nothing is narrowed, renamed,
-- dropped or re-granted, and there is no index on the column. The input limit
-- stays in the API. A column that is already TEXT is skipped, so running the
-- file again changes nothing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'webhook'
      AND column_name = 'url'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE "webhook" ALTER COLUMN "url" TYPE TEXT;
  END IF;
END $$;
