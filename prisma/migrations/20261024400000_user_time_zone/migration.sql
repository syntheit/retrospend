-- Per-user time zone. Placeholder timestamp: the orchestrator assigns the
-- final one at merge.
-- user."timeZone": the IANA zone the server reads the user's calendar days in
-- (expense days, spent() periods, membership dates, recurring due days).
-- NULL means not set yet; the server falls back to DEFAULT_TIME_ZONE. The
-- app validates names against the runtime's zone list; the CHECK only keeps
-- the column to IANA-shaped text. Nothing backfills it: the first signed-in
-- browser request sets it.
-- Settings live on "user" (like "defaultRateTypes"), so the table's grants
-- and RLS policies already cover the new column.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "timeZone" VARCHAR(64);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_time_zone_check') THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_time_zone_check"
      CHECK ("timeZone" IS NULL OR "timeZone" ~ '^[A-Za-z0-9_+/-]{1,64}$');
  END IF;
END $$;
