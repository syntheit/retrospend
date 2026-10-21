-- Money fixes (batch 3).
-- 1. expense."exchangeRate" widens from DECIMAL(10,4) to DECIMAL(18,6), the
--    same precision as exchange_rate.rate. The old type overflowed on IRR
--    (about 1.27M per USD) and cut small crypto rates to 4 decimals.
--    Widening keeps every existing value as is.
-- 2. shared_transaction."exchangeRate": nullable rate captured when a shared
--    expense is saved, so shares convert at the rate of their own date instead
--    of today's. Legacy rows stay NULL and fall back to a rate lookup.
-- 3. recurring_template."anchorDay": nullable day of month that monthly and
--    quarterly steps clamp to. NULL means "use the day of nextDueDate".

ALTER TABLE "expense" ALTER COLUMN "exchangeRate" SET DATA TYPE DECIMAL(18,6);

ALTER TABLE "shared_transaction" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,6);

ALTER TABLE "recurring_template" ADD COLUMN IF NOT EXISTS "anchorDay" INTEGER;
