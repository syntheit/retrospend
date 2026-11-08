-- An index for the duplicate check that does not name the title (E2EE lane D7).
-- The check filters by user, day, amount and currency in SQL and compares
-- titles in the app, because a title can be ciphertext
-- (docs/roadmap/e2ee-spike.md, section 3). The old index
-- "expense_userId_date_title_amount_currency_idx" stays until the owner
-- schedules its drop (prisma/deferred/D7_drop_duplicate_title_index).
-- Locking: CREATE INDEX CONCURRENTLY cannot run inside a transaction block,
-- and a failed concurrent build leaves an invalid index that IF NOT EXISTS
-- would then skip on a rerun, so this is a plain CREATE INDEX like the other
-- index builds here (see 20261023110000_money_in). It takes a SHARE lock on
-- expense (reads continue, writes wait) while it builds, once, at container
-- start before the app serves requests. Additive and idempotent: a rerun
-- skips it. An index needs no grants or RLS.

CREATE INDEX IF NOT EXISTS "expense_userId_date_amount_currency_idx"
  ON "expense"("userId", "date", "amount", "currency");
