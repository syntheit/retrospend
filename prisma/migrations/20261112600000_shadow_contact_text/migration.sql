-- A ghost's email and phone are sealed with the creator's key (E2EE lane D11,
-- Revision 3, PR 3b; plan docs/roadmap/e2ee-d11-rev3.md). A sealed value is
-- longer than the plaintext (4 * limit + 48 characters), so a VarChar(n) sized
-- for the address would reject the first sealed write. VarChar(n) to TEXT keeps
-- the same storage and takes no table rewrite; the input limits stay in the
-- API. The "email" index keeps working for plaintext rows. Nothing is narrowed,
-- renamed, dropped or re-granted; the shadow_profile_isolation policy and the
-- table-level grants are unchanged. A column that is already TEXT is skipped,
-- so running the file again changes nothing.

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('shadow_profile', 'email'),
      ('shadow_profile', 'phone')
    ) AS t(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = target.table_name
        AND column_name = target.column_name
        AND data_type = 'character varying'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TEXT', target.table_name, target.column_name);
    END IF;
  END LOOP;
END $$;
