-- API v1 platform stores (M16).
-- 1. idempotency_key: the first response per user and Idempotency-Key,
--    kept 24h. Read and written through the user-scoped db, so RLS holds.
-- 2. api_rate_limit: fixed-window counters per IP and per token. Not user
--    data (IP keys have no user), so only the owner connection touches it:
--    RLS is on with no policy and the app role has no grant.

CREATE TABLE IF NOT EXISTS "idempotency_key" (
  "id"           TEXT         NOT NULL,
  "userId"       TEXT         NOT NULL,
  "key"          VARCHAR(255) NOT NULL,
  "requestHash"  VARCHAR(64)  NOT NULL,
  "completedAt"  TIMESTAMP(3),
  "status"       INTEGER,
  "responseBody" JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_key_userId_key_key" ON "idempotency_key"("userId", "key");
CREATE INDEX        IF NOT EXISTS "idempotency_key_expiresAt_idx"  ON "idempotency_key"("expiresAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_key_userId_fkey') THEN
    ALTER TABLE "idempotency_key"
      ADD CONSTRAINT "idempotency_key_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "api_rate_limit" (
  "key"         VARCHAR(255) NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count"       INTEGER      NOT NULL,
  CONSTRAINT "api_rate_limit_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "api_rate_limit_windowStart_idx" ON "api_rate_limit"("windowStart");

ALTER TABLE "idempotency_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_key" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idempotency_key_isolation ON "idempotency_key";
CREATE POLICY idempotency_key_isolation ON "idempotency_key"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_key" TO retrospend_app;

ALTER TABLE "api_rate_limit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_rate_limit" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "api_rate_limit" FROM retrospend_app;
