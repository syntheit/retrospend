-- API v1 platform (G5b): the event outbox, webhooks and their delivery log.
-- 1. api_event: one row per event per user who sees it, inserted in the same
--    transaction as the change. The app role may read its own rows and insert
--    rows for itself only (a shared write that must reach another person's
--    feed needs recipients computed from membership first, so no policy lets
--    an actor write into someone else's feed); it can never update or delete
--    one. `txid` (the writing
--    transaction) and `seq` order the feed: readers only see rows whose txid
--    is below the oldest open transaction, so a late commit is never skipped.
--    The owner connection (the webhook worker, retention) bypasses RLS: RLS
--    is on, not forced.
-- 2. webhook: the user's endpoints; full access to the own rows. The secret
--    is stored encrypted.
-- 3. webhook_delivery: the delivery log. The app role reads its own rows;
--    only the owner connection (the worker) writes them.
-- Events and the log carry ids, types and amounts, never titles or notes.

CREATE TABLE IF NOT EXISTS "api_event" (
  "id"          TEXT         NOT NULL,
  "seq"         BIGSERIAL    NOT NULL,
  "txid"        xid8         NOT NULL DEFAULT pg_current_xact_id(),
  "userId"      TEXT         NOT NULL,
  "actorUserId" TEXT,
  "type"        VARCHAR(64)  NOT NULL,
  "entityType"  VARCHAR(64),
  "entityId"    VARCHAR(64),
  "payload"     JSONB        NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fannedOutAt" TIMESTAMP(3),
  CONSTRAINT "api_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_event_seq_key"             ON "api_event"("seq");
CREATE INDEX        IF NOT EXISTS "api_event_userId_txid_seq_idx" ON "api_event"("userId", "txid", "seq");
CREATE INDEX        IF NOT EXISTS "api_event_createdAt_idx"       ON "api_event"("createdAt");
-- The worker's queue of events still to fan out to webhooks.
CREATE INDEX        IF NOT EXISTS "api_event_unfanned_idx"        ON "api_event"("txid") WHERE "fannedOutAt" IS NULL;

CREATE TABLE IF NOT EXISTS "webhook" (
  "id"                  TEXT          NOT NULL,
  "userId"              TEXT          NOT NULL,
  "name"                TEXT          NOT NULL,
  "url"                 VARCHAR(2048) NOT NULL,
  "eventTypes"          TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "secretCipher"        VARCHAR(512)  NOT NULL,
  "secretStart"         VARCHAR(16)   NOT NULL,
  "enabled"             BOOLEAN       NOT NULL DEFAULT true,
  "consecutiveFailures" INTEGER       NOT NULL DEFAULT 0,
  "disabledAt"          TIMESTAMP(3),
  "disabledReason"      VARCHAR(32),
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "webhook_userId_idx" ON "webhook"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WebhookDeliveryStatus') THEN
    CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "webhook_delivery" (
  "id"             TEXT                    NOT NULL,
  "webhookId"      TEXT                    NOT NULL,
  "userId"         TEXT                    NOT NULL,
  "eventId"        TEXT,
  "eventType"      VARCHAR(64)             NOT NULL,
  "status"         "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER                 NOT NULL DEFAULT 0,
  "nextAttemptAt"  TIMESTAMP(3),
  "lastAttemptAt"  TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "lastError"      VARCHAR(64),
  "deliveredAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- One delivery per event and webhook, so a second worker cannot fan out twice.
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_delivery_webhookId_eventId_key" ON "webhook_delivery"("webhookId", "eventId");
CREATE INDEX IF NOT EXISTS "webhook_delivery_webhookId_createdAt_idx"ON "webhook_delivery"("webhookId", "createdAt");
CREATE INDEX IF NOT EXISTS "webhook_delivery_status_nextAttemptAt_idx" ON "webhook_delivery"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "webhook_delivery_eventId_idx" ON "webhook_delivery"("eventId");
CREATE INDEX IF NOT EXISTS "webhook_delivery_userId_idx" ON "webhook_delivery"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_event_userId_fkey') THEN
    ALTER TABLE "api_event"
      ADD CONSTRAINT "api_event_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_userId_fkey') THEN
    ALTER TABLE "webhook"
      ADD CONSTRAINT "webhook_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_delivery_webhookId_fkey') THEN
    ALTER TABLE "webhook_delivery"
      ADD CONSTRAINT "webhook_delivery_webhookId_fkey"
      FOREIGN KEY ("webhookId") REFERENCES "webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_delivery_eventId_fkey') THEN
    ALTER TABLE "webhook_delivery"
      ADD CONSTRAINT "webhook_delivery_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "api_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "api_event" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_event_read ON "api_event";
CREATE POLICY api_event_read ON "api_event"
  AS PERMISSIVE FOR SELECT TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE));

DROP POLICY IF EXISTS api_event_insert ON "api_event";
CREATE POLICY api_event_insert ON "api_event"
  AS PERMISSIVE FOR INSERT TO retrospend_app
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

-- Default privileges give the app role every verb on new tables; events are
-- append-only for it.
GRANT SELECT, INSERT ON "api_event" TO retrospend_app;
REVOKE UPDATE, DELETE ON "api_event" FROM retrospend_app;
GRANT USAGE, SELECT ON SEQUENCE "api_event_seq_seq" TO retrospend_app;

ALTER TABLE "webhook" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_isolation ON "webhook";
CREATE POLICY webhook_isolation ON "webhook"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook" TO retrospend_app;

ALTER TABLE "webhook_delivery" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_delivery_read ON "webhook_delivery";
CREATE POLICY webhook_delivery_read ON "webhook_delivery"
  AS PERMISSIVE FOR SELECT TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT ON "webhook_delivery" TO retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "webhook_delivery" FROM retrospend_app;

-- Admin setting: may webhooks target private, loopback and link-local
-- addresses (a self-hoster's LAN)? Off unless an admin turns it on.
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "webhooksAllowPrivateTargets" BOOLEAN NOT NULL DEFAULT false;
