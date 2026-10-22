-- Money in (M1, budget build plan P1). Placeholder timestamp: the
-- orchestrator assigns the final one at merge.
-- 1. expense."direction" (OUT default), "entryKind" (STANDARD default),
--    "inType" (INCOME or REFUND, only on IN STANDARD rows) and
--    "amortizeMode" (INSTALLMENTS default). Every existing row is spending,
--    which is exactly what the defaults say, so nothing is backfilled.
--    Columns with a constant default are added without a table rewrite.
-- 2. A CHECK keeps inType consistent with direction and entryKind, so a
--    money-in row can never look like spending to a reader. Added NOT VALID,
--    then validated, so a rerun skips the ADD and still validates.
-- 3. expense ("userId", "direction", "date") for the money-in reads.
-- 4. category."kind" (EXPENSE default). Income categories are seeded per user
--    on first use (ensureIncomeCategories), not here, so today's category
--    pickers keep showing exactly the rows they show now.
-- 5. recurring_template."amount" widens to DECIMAL(19,8) like expense.amount;
--    "direction" (OUT default) and "amountMode" (FIXED default) let a
--    template post recurring income. Widening keeps every value.
-- Locking: Prisma applies this file in one transaction, so CREATE INDEX
-- CONCURRENTLY is not possible, and the ACCESS EXCLUSIVE lock the first
-- ADD COLUMN takes on expense is held through the VALIDATE scan and the
-- index build until commit. It runs once at container start, before the app
-- serves requests, so the lock is brief.
-- Grants and RLS policies are per table and every change here is a column
-- on an existing table, so they need nothing new.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExpenseDirection') THEN
    CREATE TYPE "ExpenseDirection" AS ENUM ('OUT', 'IN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntryKind') THEN
    CREATE TYPE "EntryKind" AS ENUM ('STANDARD', 'STARTING_BALANCE', 'ADJUSTMENT', 'NOT_SPENDING');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InType') THEN
    CREATE TYPE "InType" AS ENUM ('INCOME', 'REFUND');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmortizeMode') THEN
    CREATE TYPE "AmortizeMode" AS ENUM ('INSTALLMENTS', 'REPORTS_ONLY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CategoryKind') THEN
    CREATE TYPE "CategoryKind" AS ENUM ('EXPENSE', 'INCOME');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecurringAmountMode') THEN
    CREATE TYPE "RecurringAmountMode" AS ENUM ('FIXED', 'ASK');
  END IF;
END $$;

ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "direction"    "ExpenseDirection" NOT NULL DEFAULT 'OUT';
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "entryKind"    "EntryKind"        NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "inType"       "InType";
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "amortizeMode" "AmortizeMode"     NOT NULL DEFAULT 'INSTALLMENTS';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_in_type_check') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_in_type_check"
      CHECK (("direction" = 'IN' AND "entryKind" = 'STANDARD') = ("inType" IS NOT NULL)) NOT VALID;
  END IF;
END $$;
ALTER TABLE "expense" VALIDATE CONSTRAINT "expense_in_type_check";

CREATE INDEX IF NOT EXISTS "expense_userId_direction_date_idx"
  ON "expense" ("userId", "direction", "date");

ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "kind" "CategoryKind" NOT NULL DEFAULT 'EXPENSE';

ALTER TABLE "recurring_template" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(19,8);
ALTER TABLE "recurring_template" ADD COLUMN IF NOT EXISTS "direction"  "ExpenseDirection"    NOT NULL DEFAULT 'OUT';
ALTER TABLE "recurring_template" ADD COLUMN IF NOT EXISTS "amountMode" "RecurringAmountMode" NOT NULL DEFAULT 'FIXED';
