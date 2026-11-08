-- D7: drop the old duplicate-check index that includes the title (E2EE lane D7).
--
-- NOT APPLIED. This folder sits outside prisma/migrations on purpose, so
-- `prisma migrate deploy` never runs it. The duplicate check no longer filters
-- by title in SQL once titles may be ciphertext; it uses
-- "expense_userId_date_amount_currency_idx" (migration 20261109300000), which
-- must be live in production first.
--
-- To run it, once the owner schedules it:
--   1. Confirm the new index exists and is valid:
--        SELECT indisvalid FROM pg_index
--         WHERE indexrelid = 'expense_userId_date_amount_currency_idx'::regclass;
--   2. Move this folder to prisma/migrations/<timestamp>_drop_duplicate_title_index/.
--   3. In the same commit remove the line
--        @@index([userId, date, title, amount, currency])
--      from model Expense in prisma/schema.prisma.
-- Rerunning is safe. The drop frees the index's space and stops every expense
-- write from maintaining it.

DROP INDEX IF EXISTS "expense_userId_date_title_amount_currency_idx";
