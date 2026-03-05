-- Remove budgetMode
ALTER TABLE "user" DROP COLUMN IF EXISTS "budgetMode";
DROP TYPE IF EXISTS "BudgetMode";

-- Add fiscal month start day
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "fiscalMonthStartDay" INTEGER NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fiscalMonthStartDay_check') THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_fiscalMonthStartDay_check" CHECK ("fiscalMonthStartDay" >= 1 AND "fiscalMonthStartDay" <= 28);
  END IF;
END $$;

-- Add default expense date behavior
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DefaultExpenseDateBehavior') THEN
    CREATE TYPE "DefaultExpenseDateBehavior" AS ENUM ('TODAY', 'LAST_USED');
  END IF;
END $$;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "defaultExpenseDateBehavior" "DefaultExpenseDateBehavior" NOT NULL DEFAULT 'TODAY';
