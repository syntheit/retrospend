-- The mark shown beside an account. Placeholder timestamp: the orchestrator
-- assigns the final one at merge.
-- asset_account."iconKind" / "iconValue": NULL for both (everyone, nothing
-- backfills it) keeps the default glyph for the account's type.
--   BRAND     iconValue is a bundled logo's slug ("revolut")
--   MONOGRAM  iconValue is an avatar palette slot ("avatar-3"); the mark is
--             the first letter of the name on that color
--   IMAGE     iconValue is the uploaded file's path ("accounts/<id>-<ms>.webp")
-- Only the owner's own rows carry it, so the table's grants and RLS policies
-- already cover the new columns.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountIconKind') THEN
    CREATE TYPE "AccountIconKind" AS ENUM ('BRAND', 'MONOGRAM', 'IMAGE');
  END IF;
END $$;

ALTER TABLE "asset_account" ADD COLUMN IF NOT EXISTS "iconKind" "AccountIconKind";
ALTER TABLE "asset_account" ADD COLUMN IF NOT EXISTS "iconValue" VARCHAR(500);
