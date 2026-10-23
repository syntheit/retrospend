-- Import duplicate rule (queue-import-dupes.md). Placeholder timestamp: the
-- orchestrator assigns the final one at merge.
-- expense."importFingerprint": a hash of the file row an import created this
-- expense from (day, currency, amount, proposed kind, normalized description),
-- so importing the same row again is recognized even after its title or
-- category was edited. NULL for every row the Import page did not create.
-- A column on "expense": the table's grants and RLS policies already cover it.

ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "importFingerprint" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "expense_userId_importFingerprint_idx"
  ON "expense" ("userId", "importFingerprint");
