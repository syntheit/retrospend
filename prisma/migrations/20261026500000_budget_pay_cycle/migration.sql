-- Budget setup pay step (web follow-up, GAPS "Set up, pay step").
-- Placeholder timestamp: the orchestrator assigns the final one at merge.
-- budget_book.payFrequency and payAnchor: how often the person is paid and a
-- pay date the cycle counts from, so the plan can start from the next pay.
-- Neither holds user text. Both are null for a book set up without the step.
-- RLS and grants are the table's own (budget_book already has both).
-- Additive and idempotent.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayFrequency') THEN
    CREATE TYPE "PayFrequency" AS ENUM ('MONTHLY', 'EVERY_TWO_WEEKS', 'WEEKLY', 'VARIES');
  END IF;
END $$;

ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "payFrequency" "PayFrequency";
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "payAnchor" DATE;
