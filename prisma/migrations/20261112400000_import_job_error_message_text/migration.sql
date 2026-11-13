-- import_job.errorMessage holds sealed text from now on (E2EE lane D11,
-- Revision 3 PR 5, docs/roadmap/e2ee-d11-rev3.md). A sealed value is at most
-- 4 * plaintext + 48 characters, which VarChar(1000) rejects on the first
-- sealed write. Same rule and method as 20261110000000_widen_mapped_text:
-- VarChar(n) to TEXT keeps the storage and takes no rewrite, the 1000
-- character cap stays in the service, and nothing is narrowed, renamed,
-- dropped or re-granted. A column that is already TEXT is skipped, so
-- running the file again changes nothing. The policy import_job_isolation and
-- the grants are untouched.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'import_job'
      AND column_name = 'errorMessage'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE "import_job" ALTER COLUMN "errorMessage" TYPE TEXT;
  END IF;
END $$;
