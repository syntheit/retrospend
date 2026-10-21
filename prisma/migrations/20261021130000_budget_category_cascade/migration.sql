-- Budgets of a deleted category (batch 4).
-- 1. budget."categoryId" goes back to ON DELETE CASCADE. With SET NULL a
--    deleted category's budgets turned into extra global budgets (categoryId
--    NULL), and the dashboard could pick one as the monthly total.
-- 2. Removes the global budgets that can only have come from a deleted
--    category: global budgets are only ever created with type FIXED, no
--    rollover and no peg, so a NULL-category row with any of those settings
--    was a category budget. Orphans that look exactly like a global budget
--    cannot be told apart and are left alone.
-- Touches only the budget table: a constraint swap and a narrow DELETE, no
-- table rewrite.

ALTER TABLE "budget" DROP CONSTRAINT IF EXISTS "budget_categoryId_fkey";
ALTER TABLE "budget" ADD CONSTRAINT "budget_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM "budget"
WHERE "categoryId" IS NULL
  AND (
    "type" <> 'FIXED'
    OR "pegToActual" = true
    OR "isRollover" = true
    OR "rolloverAmount" <> 0
  );
