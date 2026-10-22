-- M5 project_membership_dates: when each project member joined and left.
-- Additive and idempotent. No new table, so no new RLS policy or GRANT: the
-- columns are covered by project_participant's existing policies and the
-- table-level grants to retrospend_app.

ALTER TABLE "project_participant" ADD COLUMN IF NOT EXISTS "joinedOn" DATE;
ALTER TABLE "project_participant" ADD COLUMN IF NOT EXISTS "leftOn" DATE;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_participant_membership_dates_check'
  ) THEN
    ALTER TABLE "project_participant"
      ADD CONSTRAINT "project_participant_membership_dates_check"
      CHECK ("leftOn" IS NULL OR "joinedOn" IS NULL OR "leftOn" > "joinedOn");
  END IF;
END $$;

-- Backfill from when each row was created (joinedAt), for people added after
-- the day the project was created. Their date is the earlier of that day and
-- the first expense in the project that names them (as payer or in the
-- split), so nobody is dated after an expense they are already part of.
-- People added on the project's first day (always the creator) keep NULL,
-- "member from the start": trips are often entered after the fact, with
-- expenses dated before the project existed.
-- Days are read in Buenos Aires, the same default as userTimeZone() in
-- src/server/services/user-time-zone.ts (timestamps are stored as UTC).
-- Only rows still NULL are touched, so running this twice changes nothing.
UPDATE "project_participant" AS pp
SET "joinedOn" = LEAST(
  (pp."joinedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
  COALESCE(
    (
      SELECT MIN((t."date" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
      FROM "shared_transaction" t
      WHERE t."projectId" = pp."projectId"
        AND (
          (t."paidByType" = pp."participantType" AND t."paidById" = pp."participantId")
          OR EXISTS (
            SELECT 1 FROM "split_participant" sp
            WHERE sp."transactionId" = t."id"
              AND sp."participantType" = pp."participantType"
              AND sp."participantId" = pp."participantId"
          )
        )
    ),
    (pp."joinedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  )
)
FROM "project" p
WHERE p."id" = pp."projectId"
  AND pp."joinedOn" IS NULL
  AND (pp."joinedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')::date > (p."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
