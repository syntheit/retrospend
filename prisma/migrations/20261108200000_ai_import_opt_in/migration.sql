-- AI import is opt-in per user. Placeholder timestamp: the orchestrator
-- assigns the final one at merge.
-- user."aiImportEnabled": false for new accounts. An account that already
-- used AI import keeps working: it is switched on once, when the column is
-- created, if it has token usage, a bank statement import job, or chose the
-- external model. Everyone else is off until they turn it on.
-- The backfill runs only in the block that adds the column, so running the
-- file again never switches back on an account that turned it off. The user
-- table's grants and RLS policies already cover the new column.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'user' AND column_name = 'aiImportEnabled'
  ) THEN
    ALTER TABLE "user" ADD COLUMN "aiImportEnabled" BOOLEAN NOT NULL DEFAULT false;
    UPDATE "user" u SET "aiImportEnabled" = true
    WHERE u."aiMode" = 'EXTERNAL'
       OR EXISTS (SELECT 1 FROM "ai_usage" a WHERE a."userId" = u."id" AND a."tokensUsed" > 0)
       OR EXISTS (SELECT 1 FROM "import_job" j WHERE j."userId" = u."id" AND j."type" = 'BANK_STATEMENT');
  END IF;
END $$;
