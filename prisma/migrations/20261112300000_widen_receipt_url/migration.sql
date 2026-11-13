-- Widen shared_transaction.receiptUrl to TEXT (E2EE lane D11, revision 3 PR 6).
-- The field map (src/server/crypto/fields.ts) now seals the column under the
-- instance key. A sealed value is at most 4 * limit + 48 characters for an
-- input limit in UTF-16 units, which a VarChar(2048) sized for plaintext
-- rejects on the first sealed write. Same rule and method as
-- 20261110000000_widen_mapped_text: VarChar(n) to TEXT keeps the same storage
-- and takes no table rewrite or index rebuild, and the 2048 input limit stays
-- in the API. Nothing is narrowed, renamed, dropped or re-granted (policy
-- shared_transaction_access and the grants are unchanged). A column that
-- is already TEXT is skipped, so running the file again changes nothing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'shared_transaction'
      AND column_name = 'receiptUrl'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE "shared_transaction" ALTER COLUMN "receiptUrl" TYPE TEXT;
  END IF;
END $$;
