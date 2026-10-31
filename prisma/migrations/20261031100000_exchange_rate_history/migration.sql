-- The rate sync rewrote one row per currency and type in place, so no
-- history existed. This table keeps one rate per day, currency and type; the
-- sidecar writes it on every sync and scripts/backfill-rate-history.ts fills
-- the days before. The newest stored rates seed it so a chart has a point on
-- day one. Shared data like exchange_rate: no RLS, the app role may only read.

CREATE TABLE IF NOT EXISTS "exchange_rate_history" (
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT 'official',
    "rate" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "exchange_rate_history_pkey" PRIMARY KEY ("date","currency","type")
);

CREATE INDEX IF NOT EXISTS "exchange_rate_history_currency_type_date_idx"
    ON "exchange_rate_history"("currency", "type", "date");

INSERT INTO "exchange_rate_history" ("date", "currency", "type", "rate")
SELECT "date"::date, "currency", "type", "rate"
FROM "exchange_rate"
ON CONFLICT DO NOTHING;

GRANT SELECT ON "exchange_rate_history" TO retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "exchange_rate_history" FROM retrospend_app;
