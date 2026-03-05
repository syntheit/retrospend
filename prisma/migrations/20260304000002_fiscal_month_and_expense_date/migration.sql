-- Remove budgetMode
ALTER TABLE "user" DROP COLUMN IF EXISTS "budgetMode";
DROP TYPE IF EXISTS "BudgetMode";

-- Add fiscal month start day
ALTER TABLE "user" ADD COLUMN "fiscalMonthStartDay" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "user" ADD CONSTRAINT "user_fiscalMonthStartDay_check" CHECK ("fiscalMonthStartDay" >= 1 AND "fiscalMonthStartDay" <= 28);

-- Add default expense date behavior
CREATE TYPE "DefaultExpenseDateBehavior" AS ENUM ('TODAY', 'LAST_USED');
ALTER TABLE "user" ADD COLUMN "defaultExpenseDateBehavior" "DefaultExpenseDateBehavior" NOT NULL DEFAULT 'TODAY';
