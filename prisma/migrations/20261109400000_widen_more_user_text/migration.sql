-- Widen the rest of the bounded user-text columns to TEXT (E2EE lane D4b).
-- The write paths for these fields now validate through userText(), so the
-- capacity rule of 20261109200000_widen_user_text applies to them too: field
-- encryption stores at most 4 * limit + 48 characters for an input limit in
-- UTF-16 units, which a VarChar(n) sized for plaintext would reject. Input
-- limits stay in the API. VarChar(n) to TEXT keeps the same storage and takes
-- no table rewrite or index rebuild. Nothing is narrowed, renamed or dropped.
-- A column that is already TEXT is skipped, so running the file again changes
-- nothing.

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('user', 'name'),
      ('guest_session', 'name'),
      ('apikey', 'name')
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
