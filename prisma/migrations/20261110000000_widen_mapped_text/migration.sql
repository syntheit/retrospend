-- Widen the mapped user-text columns that were still bounded to TEXT (E2EE lane D11).
-- The field map (src/server/crypto/fields.ts) names every column D11 seals. A
-- sealed value is at most 4 * limit + 48 characters for an input limit in
-- UTF-16 units, which a VarChar(n) sized for plaintext rejects on the first
-- sealed write. Same rule and same method as 20261109200000_widen_user_text
-- and 20261109400000_widen_more_user_text: VarChar(n) to TEXT keeps the same
-- storage and takes no table rewrite or index rebuild, and the input limits
-- stay in the API. Nothing is narrowed, renamed, dropped or re-granted. A
-- column that is already TEXT is skipped, so running the file again changes
-- nothing.

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('budget_book', 'name'),
      ('budget_movement', 'note'),
      ('wealth_transfer', 'note'),
      ('export_job', 'fileName'),
      ('push_device', 'deviceName')
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
