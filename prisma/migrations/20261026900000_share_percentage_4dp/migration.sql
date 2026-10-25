-- A typed split percentage is kept to the 4 decimals the API takes (it was 2, so
-- 12.3456 came back as 12.35 and an amount edit re-split from the wrong value).
-- Placeholder timestamp: the orchestrator assigns the final one at merge.
-- No value is lost, but the scale changes (2 to 4), so Postgres rewrites the
-- split_participant table and holds a lock on it while it does. No new table,
-- so no RLS change.
-- Idempotent: running it again changes nothing.

ALTER TABLE "split_participant" ALTER COLUMN "sharePercentage" TYPE DECIMAL(7,4);
