-- Change Expense→Category from CASCADE to SET NULL
ALTER TABLE "expense" DROP CONSTRAINT IF EXISTS "expense_categoryId_fkey";
ALTER TABLE "expense" ADD CONSTRAINT "expense_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Change Budget→Category from CASCADE to SET NULL
ALTER TABLE "budget" DROP CONSTRAINT IF EXISTS "budget_categoryId_fkey";
ALTER TABLE "budget" ADD CONSTRAINT "budget_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add CHECK constraints for data integrity
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_amount_positive') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_amount_positive" CHECK (amount > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_exchange_rate_positive') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_exchange_rate_positive" CHECK ("exchangeRate" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_amount_non_negative') THEN
    ALTER TABLE "budget" ADD CONSTRAINT "budget_amount_non_negative" CHECK (amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exchange_rate_rate_positive') THEN
    ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_rate_positive" CHECK (rate > 0);
  END IF;
END $$;
