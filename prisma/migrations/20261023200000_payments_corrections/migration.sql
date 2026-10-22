-- M3 payments_corrections, part 1 (2C.1): the Payment header.
--
-- 1. "payment": one row per payment as people see it (MONEY-MOVES §1.1). Its
--    id is the paymentGroupId its settlement rows share. The rows keep the
--    allocation per scope and debt currency; the header keeps what was paid,
--    in the currency it was paid in, plus who recorded it and the day the
--    money moved ("Settled since" reads it).
-- 2. settlement."kind" (PAYMENT / FORGIVE), "rateType" and "forgiveEnvelopeId".
-- 3. Backfill: every settlement row gets a group (a legacy single row becomes
--    a group of one, id = its own id) and every group gets a header.
-- 4. settlement."paymentGroupId" references payment(id), ON DELETE CASCADE.
--
-- Additive and idempotent: every statement can run twice. The backfill only
-- touches rows without a group and groups without a header.
-- SharedTransaction.correctsId and the ask-to-fix state come with 2C.2.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SettlementKind') THEN
    CREATE TYPE "SettlementKind" AS ENUM ('PAYMENT', 'FORGIVE');
  END IF;
END $$;

ALTER TABLE "settlement" ADD COLUMN IF NOT EXISTS "kind" "SettlementKind" NOT NULL DEFAULT 'PAYMENT';
ALTER TABLE "settlement" ADD COLUMN IF NOT EXISTS "rateType" VARCHAR(32);
ALTER TABLE "settlement" ADD COLUMN IF NOT EXISTS "forgiveEnvelopeId" TEXT;

CREATE TABLE IF NOT EXISTS "payment" (
  "id"             TEXT NOT NULL,
  "payerType"      "ParticipantType" NOT NULL,
  "payerId"        TEXT NOT NULL,
  "payeeType"      "ParticipantType" NOT NULL,
  "payeeId"        TEXT NOT NULL,
  "amount"         DECIMAL(19,8) NOT NULL,
  "currency"       TEXT NOT NULL,
  "rateType"       VARCHAR(32),
  "rate"           DECIMAL(30,12),
  "rateCurrency"   TEXT,
  "paymentMethod"  VARCHAR(191),
  "paidOn"         DATE NOT NULL,
  "note"           VARCHAR(500),
  "recordedByType" "ParticipantType" NOT NULL,
  "recordedById"   TEXT NOT NULL,
  "status"         "SettlementStatus" NOT NULL DEFAULT 'PROPOSED',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_payerType_payerId_idx" ON "payment" ("payerType", "payerId");
CREATE INDEX IF NOT EXISTS "payment_payeeType_payeeId_idx" ON "payment" ("payeeType", "payeeId");
CREATE INDEX IF NOT EXISTS "payment_status_payeeType_payeeId_idx" ON "payment" ("status", "payeeType", "payeeId");

-- Backfill step 1: a legacy single row is a group of one. Its own id is a
-- cuid, so it cannot collide with a gen_random_uuid() group id.
UPDATE "settlement" SET "paymentGroupId" = "id" WHERE "paymentGroupId" IS NULL;

-- Backfill step 2: one header per group, from the group's lead row.
--
-- Lead: a cash row first (offset rows only in a square-up), then a row the
-- recorder sent (their flag set, the other not), then a row from a user.
-- Recorded by: the payee when the lead says the payee recorded it
-- (RECORDED_BY_PAYEE_REASON in settlement.service.ts), else the lead's payer,
-- which is who settle-up and square-up wrote as "from" on the lead.
-- Amount: the cash rows' paid amounts (convertedAmount when the row was paid
-- in another currency) in the lead's paid currency; a square-up pays 0.
-- Every cash row of one call shares its paid currency (initiateSettlement
-- converts every row to one convertedCurrency, settleAll to the payment
-- currency); the deploy pre-check counts groups where that does not hold.
-- Status: REJECTED if any row is, else PROPOSED if any row is, else the
-- lead's (settlement-groups.ts groupStatus). Rates stay NULL: legacy
-- exchangeRateUsed is a stored-convention rate, not a payment rate.
WITH ranked AS (
  SELECT s.*,
    ROW_NUMBER() OVER (
      PARTITION BY s."paymentGroupId"
      ORDER BY s."isOffset" ASC,
        (s."confirmedByPayer" AND NOT s."confirmedByPayee") DESC,
        (s."fromParticipantType" = 'user') DESC,
        s."initiatedAt" ASC,
        s."id" ASC
    ) AS rn
  FROM "settlement" s
  WHERE NOT EXISTS (SELECT 1 FROM "payment" p WHERE p."id" = s."paymentGroupId")
),
lead AS (
  SELECT * FROM ranked WHERE rn = 1
),
totals AS (
  SELECT r."paymentGroupId",
    SUM(COALESCE(r."convertedAmount", r."amount")) FILTER (
      WHERE NOT r."isOffset"
        AND COALESCE(r."convertedCurrency", r."currency") = COALESCE(l."convertedCurrency", l."currency")
    ) AS paid,
    BOOL_OR(r."status" = 'REJECTED') AS any_rejected,
    BOOL_OR(r."status" = 'PROPOSED') AS any_proposed,
    MIN(r."initiatedAt") AS first_at
  FROM ranked r
  JOIN lead l ON l."paymentGroupId" = r."paymentGroupId"
  GROUP BY r."paymentGroupId"
)
INSERT INTO "payment" (
  "id", "payerType", "payerId", "payeeType", "payeeId", "amount", "currency",
  "paymentMethod", "paidOn", "note", "recordedByType", "recordedById",
  "status", "createdAt", "updatedAt"
)
SELECT
  l."paymentGroupId",
  l."fromParticipantType", l."fromParticipantId",
  l."toParticipantType", l."toParticipantId",
  COALESCE(t.paid, 0),
  CASE WHEN l."isOffset" THEN l."currency" ELSE COALESCE(l."convertedCurrency", l."currency") END,
  l."paymentMethod",
  l."initiatedAt"::date,
  l."note",
  CASE WHEN l."autoConfirmedReason" = 'Recorded by the payee as a payment received'
    THEN l."toParticipantType" ELSE l."fromParticipantType" END,
  CASE WHEN l."autoConfirmedReason" = 'Recorded by the payee as a payment received'
    THEN l."toParticipantId" ELSE l."fromParticipantId" END,
  CASE WHEN t.any_rejected THEN 'REJECTED'::"SettlementStatus"
    WHEN t.any_proposed THEN 'PROPOSED'::"SettlementStatus"
    ELSE l."status" END,
  t.first_at,
  CURRENT_TIMESTAMP
FROM lead l
JOIN totals t ON t."paymentGroupId" = l."paymentGroupId"
ON CONFLICT ("id") DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlement_paymentGroupId_fkey') THEN
    ALTER TABLE "settlement"
      ADD CONSTRAINT "settlement_paymentGroupId_fkey"
      FOREIGN KEY ("paymentGroupId") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS: the same people see a header as see its rows (settlement_access):
-- either party, or a user sharing a project with both parties. Only a party
-- writes it.
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_access" ON "payment";
CREATE POLICY "payment_access" ON "payment"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true))
      OR ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
      OR EXISTS (
        SELECT 1 FROM "project_participant" pp_self
        WHERE pp_self."participantType" = 'user'
          AND pp_self."participantId" = current_setting('app.current_user_id', true)
          AND EXISTS (
            SELECT 1 FROM "project_participant" pp_from
            WHERE pp_from."projectId" = pp_self."projectId"
              AND pp_from."participantType" = "payment"."payerType"
              AND pp_from."participantId" = "payment"."payerId"
          )
          AND EXISTS (
            SELECT 1 FROM "project_participant" pp_to
            WHERE pp_to."projectId" = pp_self."projectId"
              AND pp_to."participantType" = "payment"."payeeType"
              AND pp_to."participantId" = "payment"."payeeId"
          )
      )
    )
    WITH CHECK (
      ("payerType" = 'user' AND "payerId" = current_setting('app.current_user_id', true))
      OR ("payeeType" = 'user' AND "payeeId" = current_setting('app.current_user_id', true))
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "payment" TO retrospend_app;
