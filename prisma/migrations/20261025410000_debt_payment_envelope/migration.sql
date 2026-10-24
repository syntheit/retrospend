-- Debt payments (budget build plan P6 review). Placeholder timestamp: the
-- orchestrator assigns the final one at merge.
-- 1. expense."budgetEnvelopeId": the envelope the budget charges this row
--    to, whatever its category. The interest of a debt payment keeps Fees
--    as its report category but comes out of the paying envelope (SPEC
--    §5.11). Null for every other row (routing by category, as before).
-- 2. payoff_plan."undo": what the last save replaced (the plan and the
--    extra envelope's target), so its undo restores them exactly and never
--    trusts the client.
-- Additive and idempotent; RLS unchanged (expense and payoff_plan policies
-- already cover the new columns).

ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "budgetEnvelopeId" TEXT;
ALTER TABLE "payoff_plan" ADD COLUMN IF NOT EXISTS "undo" JSONB;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_budgetEnvelopeId_fkey') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_budgetEnvelopeId_fkey"
      FOREIGN KEY ("budgetEnvelopeId") REFERENCES "envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
