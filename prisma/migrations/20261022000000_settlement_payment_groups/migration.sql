-- Settlement payment groups and offsets.
-- 1. settlement."paymentGroupId": shared by every row one settle-up call
--    creates. A payment entered in the People view is split into one row per
--    project scope; the group lets confirm, reject, delete and void act on
--    the whole payment at once and lets history show it as one entry.
-- 2. settlement."isOffset": marks rows that move no cash. A full settle-up
--    (or a "square up projects" action) records them to cancel a debt in one
--    scope against an opposite debt in another, so every project ends at
--    zero when the overall balance does.
-- 3. AuditAction PERIOD_REOPENED: a SETTLED billing period goes back to
--    CLOSING when the payment that settled it is rejected or voided.
-- Both columns are additive (nullable / constant default), so adding them
-- does not rewrite the table. The backfill below only updates legacy rows
-- that belong to a multi-row payment.

ALTER TABLE "settlement" ADD COLUMN IF NOT EXISTS "paymentGroupId" TEXT;
ALTER TABLE "settlement" ADD COLUMN IF NOT EXISTS "isOffset" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "settlement_paymentGroupId_idx"
  ON "settlement" ("paymentGroupId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PERIOD_REOPENED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'PERIOD_REOPENED';
  END IF;
END $$;

-- Backfill: group the legacy rows that one settle-up call created.
--
-- Before this migration a global settle-up wrote one row per project scope
-- in a single call, and every row of that call got the same initiatedAt
-- (initiateSettlement and settleAll stamp one shared `now`). So the rows of
-- one call share:
--   - the same pair: from (type, id) and to (type, id), in that direction;
--   - the same initiatedAt, to the millisecond (the column is timestamp(3));
--   - the same currency. Each currency of a multi-currency settleAll becomes
--     its own group here: a cluster never mixes currencies, which is the
--     conservative choice.
-- Two separate calls for the same pair landing on the same millisecond is
-- not realistic: the pair advisory lock serializes them and each call makes
-- several round trips first. Rows without a partner (single-row payments)
-- keep paymentGroupId = NULL and act as a group of one.
--
-- The CTE is MATERIALIZED so gen_random_uuid() runs once per cluster, not
-- once per joined row. The same rule is described in TS in
-- settlement-groups.test.ts ("legacy backfill clustering").
WITH clusters AS MATERIALIZED (
  SELECT
    "fromParticipantType", "fromParticipantId",
    "toParticipantType", "toParticipantId",
    date_trunc('milliseconds', "initiatedAt") AS initiated_ms,
    "currency",
    gen_random_uuid()::text AS group_id
  FROM "settlement"
  WHERE "paymentGroupId" IS NULL
  GROUP BY
    "fromParticipantType", "fromParticipantId",
    "toParticipantType", "toParticipantId",
    date_trunc('milliseconds', "initiatedAt"),
    "currency"
  HAVING COUNT(*) > 1
)
UPDATE "settlement" s
SET "paymentGroupId" = c.group_id
FROM clusters c
WHERE s."paymentGroupId" IS NULL
  AND s."fromParticipantType" = c."fromParticipantType"
  AND s."fromParticipantId" = c."fromParticipantId"
  AND s."toParticipantType" = c."toParticipantType"
  AND s."toParticipantId" = c."toParticipantId"
  AND date_trunc('milliseconds', s."initiatedAt") = c.initiated_ms
  AND s."currency" = c."currency";
