-- API v1 auth tokens (M11). Tables follow the schemas of the better-auth
-- plugins @better-auth/api-key 1.7.10 and device-authorization (better-auth
-- 1.7.12), checked field by field against the plugin sources.
-- 1. session."scopes" / "clientId": scopes of a device-authorization session.
-- 2. apikey: personal access tokens; "key" is the SHA-256 hash.
-- 3. device_code: pending RFC 8628 device codes.
-- better-auth writes all three through the owner connection. The app role
-- (user-scoped db) may only read and delete its own keys and read its own
-- device codes.

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "scopes"   VARCHAR(255);
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "clientId" VARCHAR(64);

CREATE TABLE IF NOT EXISTS "apikey" (
  "id"                  TEXT         NOT NULL,
  "configId"            VARCHAR(64)  NOT NULL DEFAULT 'default',
  "name"                VARCHAR(64),
  "start"               VARCHAR(32),
  "referenceId"         TEXT         NOT NULL,
  "prefix"              VARCHAR(32),
  "key"                 VARCHAR(255) NOT NULL,
  "refillInterval"      INTEGER,
  "refillAmount"        INTEGER,
  "lastRefillAt"        TIMESTAMP(3),
  "enabled"             BOOLEAN      DEFAULT true,
  "rateLimitEnabled"    BOOLEAN      DEFAULT true,
  "rateLimitTimeWindow" INTEGER,
  "rateLimitMax"        INTEGER,
  "requestCount"        INTEGER      DEFAULT 0,
  "remaining"           INTEGER,
  "lastRequest"         TIMESTAMP(3),
  "expiresAt"           TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  "permissions"         TEXT,
  "metadata"            TEXT,
  CONSTRAINT "apikey_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "apikey_key_idx"         ON "apikey"("key");
CREATE INDEX IF NOT EXISTS "apikey_referenceId_idx" ON "apikey"("referenceId");
CREATE INDEX IF NOT EXISTS "apikey_configId_idx"    ON "apikey"("configId");

CREATE TABLE IF NOT EXISTS "device_code" (
  "id"              TEXT         NOT NULL,
  "deviceCode"      VARCHAR(191) NOT NULL,
  "userCode"        VARCHAR(191) NOT NULL,
  "userId"          TEXT,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "status"          VARCHAR(16)  NOT NULL,
  "lastPolledAt"    TIMESTAMP(3),
  "pollingInterval" INTEGER,
  "clientId"        VARCHAR(64),
  "scope"           VARCHAR(255),
  CONSTRAINT "device_code_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_code_deviceCode_key" ON "device_code"("deviceCode");
CREATE UNIQUE INDEX IF NOT EXISTS "device_code_userCode_key"   ON "device_code"("userCode");
CREATE INDEX        IF NOT EXISTS "device_code_userId_idx"     ON "device_code"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apikey_referenceId_fkey') THEN
    ALTER TABLE "apikey"
      ADD CONSTRAINT "apikey_referenceId_fkey"
      FOREIGN KEY ("referenceId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_code_userId_fkey') THEN
    ALTER TABLE "device_code"
      ADD CONSTRAINT "device_code_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS: a user sees only their own keys and device codes.
ALTER TABLE "apikey"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "apikey"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "device_code" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_code" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS apikey_isolation ON "apikey";
CREATE POLICY apikey_isolation ON "apikey"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("referenceId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("referenceId" = current_setting('app.current_user_id', TRUE));

DROP POLICY IF EXISTS device_code_isolation ON "device_code";
CREATE POLICY device_code_isolation ON "device_code"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

-- The default privileges from 20260303000001_security_rls grant full CRUD
-- on new tables; narrow them. Creating or changing a key (its scopes) goes
-- through better-auth only.
GRANT SELECT, DELETE ON "apikey" TO retrospend_app;
REVOKE INSERT, UPDATE ON "apikey" FROM retrospend_app;
GRANT SELECT ON "device_code" TO retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "device_code" FROM retrospend_app;
