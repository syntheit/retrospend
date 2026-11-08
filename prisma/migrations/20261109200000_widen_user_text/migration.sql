-- Widen every bounded user-text column to TEXT (E2EE lane D4).
-- Field encryption (src/server/crypto/field-crypto.ts) stores a longer string
-- than the plaintext: at most 4 * limit + 48 characters for an input limit in
-- UTF-16 units. A VarChar(n) sized for plaintext would reject the ciphertext
-- of a long value, so these columns move to TEXT, which needs no later
-- widening if a limit or the format changes. Input limits stay in the API.
-- VarChar(n) to TEXT keeps the same storage and takes no table rewrite or
-- index rebuild. Nothing is narrowed, renamed or dropped. A column that is
-- already TEXT is skipped, so running the file again changes nothing.

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('expense', 'location'),
      ('expense', 'description'),
      ('category', 'name'),
      ('recurring_template', 'name'),
      ('recurring_template', 'websiteUrl'),
      ('recurring_template', 'paymentSource'),
      ('envelope_group', 'name'),
      ('envelope', 'name'),
      ('transfer', 'note'),
      ('shadow_profile', 'name'),
      ('shared_transaction', 'description'),
      ('split_participant', 'rejectionReason'),
      ('settlement', 'paymentMethod'),
      ('settlement', 'note'),
      ('settlement', 'rejectedReason'),
      ('payment', 'paymentMethod'),
      ('payment', 'note'),
      ('project', 'name'),
      ('project', 'description'),
      ('billing_period', 'label'),
      ('payment_method', 'label'),
      ('payment_method', 'identifier')
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
