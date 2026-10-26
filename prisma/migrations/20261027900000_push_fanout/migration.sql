-- Push fan-out (S3 milestone 5): the delivery log of pushes to devices.
-- 1. api_event."pushedAt": the push worker has looked at the event (it may
--    have found nobody to tell). The worker's queue is the partial index.
-- 2. push_delivery: one row per push per device, with its retry state. The
--    payload holds the event type, ids and an amount, never a title or note;
--    the text is built when the push is sent. Only the owner connection (the
--    push worker) reads or writes it: RLS is on with no policy, and the app
--    role has no grant.
-- 3. Deleting a device deletes its pending pushes; deleting an event keeps its
--    deliveries (they are self-contained).

ALTER TABLE "api_event" ADD COLUMN IF NOT EXISTS "pushedAt" TIMESTAMP(3);

-- Events that exist now were written before the fan-out, and must not all push
-- on the first sweep.
UPDATE "api_event" SET "pushedAt" = CURRENT_TIMESTAMP WHERE "pushedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "api_event_unpushed_idx" ON "api_event"("txid") WHERE "pushedAt" IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PushDeliveryStatus') THEN
    CREATE TYPE "PushDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "push_delivery" (
  "id"             TEXT                 NOT NULL,
  "userId"         TEXT                 NOT NULL,
  "deviceId"       TEXT                 NOT NULL,
  "eventId"        TEXT,
  "eventType"      VARCHAR(64)          NOT NULL,
  "channel"        VARCHAR(16)          NOT NULL,
  "dedupeKey"      VARCHAR(200)         NOT NULL,
  "payload"        JSONB                NOT NULL,
  "status"         "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER              NOT NULL DEFAULT 0,
  "nextAttemptAt"  TIMESTAMP(3),
  "lastAttemptAt"  TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "lastError"      VARCHAR(64),
  "sentAt"         TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_delivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_delivery_deviceId_dedupeKey_key" ON "push_delivery"("deviceId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "push_delivery_status_nextAttemptAt_idx" ON "push_delivery"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "push_delivery_userId_createdAt_idx" ON "push_delivery"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "push_delivery_eventId_idx" ON "push_delivery"("eventId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_delivery_deviceId_fkey') THEN
    ALTER TABLE "push_delivery"
      ADD CONSTRAINT "push_delivery_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "push_device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_delivery_eventId_fkey') THEN
    ALTER TABLE "push_delivery"
      ADD CONSTRAINT "push_delivery_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "api_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "push_delivery" ENABLE ROW LEVEL SECURITY;

-- Default privileges give the app role every verb on new tables; this one is
-- for the worker alone.
REVOKE ALL ON "push_delivery" FROM retrospend_app;
