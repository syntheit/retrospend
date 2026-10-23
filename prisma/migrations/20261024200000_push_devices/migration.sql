-- Push devices (M12): where the push fan-out reaches a signed-in app.
-- One row per user and address (an APNs or FCM token, or a UnifiedPush
-- endpoint). `addressHash` is the SHA-256 of that address, so the unique
-- index stays small whatever the token length. A UnifiedPush row carries
-- the Web Push subscription keys (p256dh, auth); the auth secret is never
-- returned by the API. Written through the user-scoped db, so RLS holds.
--
-- A row belongs to the credential that registered it (`sessionId` or
-- `apiKeyId`) and goes when that credential does: the foreign keys cascade
-- on sign out, session revoke and token revoke, and a trigger removes the
-- rows of a key that is disabled rather than deleted.

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
  "sessionId"   TEXT,
  "apiKeyId"    TEXT,
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
  ),
  -- A v1 caller is a session or an API key, never both.
  CONSTRAINT "push_device_credential_check" CHECK (
    num_nonnulls("sessionId", "apiKeyId") <= 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_device_userId_transport_addressHash_key"
  ON "push_device"("userId", "transport", "addressHash");
CREATE INDEX IF NOT EXISTS "push_device_userId_idx" ON "push_device"("userId");
CREATE INDEX IF NOT EXISTS "push_device_sessionId_idx" ON "push_device"("sessionId");
CREATE INDEX IF NOT EXISTS "push_device_apiKeyId_idx" ON "push_device"("apiKeyId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_device_userId_fkey') THEN
    ALTER TABLE "push_device"
      ADD CONSTRAINT "push_device_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_device_sessionId_fkey') THEN
    ALTER TABLE "push_device"
      ADD CONSTRAINT "push_device_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_device_apiKeyId_fkey') THEN
    ALTER TABLE "push_device"
      ADD CONSTRAINT "push_device_apiKeyId_fkey"
      FOREIGN KEY ("apiKeyId") REFERENCES "apikey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The api-key plugin's update endpoint can disable a key without deleting
-- it. SECURITY DEFINER so the delete reaches the rows whichever role
-- disabled the key (RLS is enabled on push_device).
CREATE OR REPLACE FUNCTION push_device_drop_for_disabled_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM "push_device" WHERE "apiKeyId" = NEW."id";
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS push_device_disabled_key ON "apikey";
CREATE TRIGGER push_device_disabled_key
  AFTER UPDATE OF "enabled" ON "apikey"
  FOR EACH ROW
  WHEN (NEW."enabled" IS FALSE AND OLD."enabled" IS DISTINCT FROM FALSE)
  EXECUTE FUNCTION push_device_drop_for_disabled_key();

-- ENABLE without FORCE: the fan-out worker reads every user's devices
-- through the owner connection.
ALTER TABLE "push_device" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_device_isolation ON "push_device";
CREATE POLICY push_device_isolation ON "push_device"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON "push_device" TO retrospend_app;
