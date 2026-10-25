-- Migration and cut-over prep (budget build plan P7). Placeholder
-- timestamp: the orchestrator assigns the final one at merge.
-- 1. expense."budgetEnvelopeId" index: the foreign key (ON DELETE SET NULL)
--    scans the table whenever an envelope or a whole book is deleted (a
--    migration rollback, a setup undo), and the engine reads the column for
--    every debt payment's interest.
-- 2. budget_book."legacyNoticeSeenAt": "Your limits moved to the new
--    budget. Nothing to set up." shows once for a book that
--    legacyMigratedAt (M6) marks as moved from the old budget, until the
--    person dismisses it.
-- 3. budget_book."legacyHiddenIds": the ids of the "Hide from reports"
--    expenses of the first month, found when the book was made. The
--    hidden-rows review only answers rows in this set, and rolling the move
--    back hides them again exactly as the old budget saw them.
-- Additive and idempotent; RLS unchanged (the expense and budget_book
-- policies and grants already cover the new column).

CREATE INDEX IF NOT EXISTS "expense_budgetEnvelopeId_idx" ON "expense"("budgetEnvelopeId");

ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "legacyNoticeSeenAt" TIMESTAMP(3);
ALTER TABLE "budget_book" ADD COLUMN IF NOT EXISTS "legacyHiddenIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
