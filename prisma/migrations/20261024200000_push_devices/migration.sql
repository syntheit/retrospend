-- Push devices (M12): where the push fan-out reaches a signed-in app.
-- One row per user and address (an APNs or FCM token, or a UnifiedPush
-- endpoint). `addressHash` is the SHA-256 of that address, so the unique
-- index stays small whatever the token length. A UnifiedPush row carries
-- the Web Push subscription keys (p256dh, auth); the auth secret is never
-- returned by the API. Written through the user-scoped db, so RLS holds.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PushPlatform') THEN
    CREATE TYPE "PushPlatform" AS ENUM ('IOS', 'ANDROID');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PushTransport') THEN
    CREATE TYPE "PushTransport" AS ENUM ('APNS', 'FCM', 'UNIFIEDPUSH');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "push_device" (
  "id"          TEXT            NOT NULL,
  "userId"      TEXT            NOT NULL,
  "platform"    "PushPlatform"  NOT NULL,
  "transport"   "PushTransport" NOT NULL,
  "token"       VARCHAR(4096),
  "endpoint"    VARCHAR(2048),
  "p256dh"      VARCHAR(255),
  "auth"        VARCHAR(255),
  "addressHash" VARCHAR(64)     NOT NULL,
  "apnsSandbox" BOOLEAN         NOT NULL DEFAULT false,
  "appVersion"  VARCHAR(32),
  "deviceName"  VARCHAR(100),
  "lastSeenAt"  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_device_pkey" PRIMARY KEY ("id"),
  -- APNs and FCM address a device by token; UnifiedPush by an endpoint
  -- URL plus the Web Push keys the payload is encrypted to.
  CONSTRAINT "push_device_address_check" CHECK (
    ("transport" IN ('APNS', 'FCM')
      AND "token" IS NOT NULL AND "endpoint" IS NULL
      AND "p256dh" IS NULL AND "auth" IS NULL)
    OR ("transport" = 'UNIFIEDPUSH'
      AND "token" IS NULL AND "endpoint" IS NOT NULL
      AND "p256dh" IS NOT NULL AND "auth" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_device_userId_transport_addressHash_key"
  ON "push_device"("userId", "transport", "addressHash");
CREATE INDEX IF NOT EXISTS "push_device_userId_idx" ON "push_device"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_device_userId_fkey') THEN
    ALTER TABLE "push_device"
      ADD CONSTRAINT "push_device_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ENABLE without FORCE: the fan-out worker reads every user's devices
-- through the owner connection.
ALTER TABLE "push_device" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_device_isolation ON "push_device";
CREATE POLICY push_device_isolation ON "push_device"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON "push_device" TO retrospend_app;
