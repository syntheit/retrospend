-- Per-user number format. Placeholder timestamp: the orchestrator assigns the
-- final one at merge.
-- user."numberFormat": which marks the user's amounts group and split digits
-- with. NULL (the default for everyone, nothing backfills it) follows the app
-- language, as before. A value overrides the language's group and decimal
-- marks on every client and keeps the language's sign and symbol position:
--   comma_dot    1,234.56
--   dot_comma    1.234,56
--   space_comma  1 234,56 (narrow no-break space)
-- Settings live on "user" (like "currencySymbolStyle"), so the table's grants
-- and RLS policies already cover the new column.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NumberFormat') THEN
    CREATE TYPE "NumberFormat" AS ENUM ('comma_dot', 'dot_comma', 'space_comma');
  END IF;
END $$;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "numberFormat" "NumberFormat";
