-- ============================================================
-- AI Provider Support: enums, user/app_settings columns, ai_usage table
-- ============================================================

-- Create enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiMode') THEN
    CREATE TYPE "AiMode" AS ENUM ('LOCAL', 'EXTERNAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExternalAiAccessMode') THEN
    CREATE TYPE "ExternalAiAccessMode" AS ENUM ('WHITELIST', 'BLACKLIST');
  END IF;
END $$;

-- Add AI columns to user table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "aiMode" "AiMode" NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "externalAiAllowed" BOOLEAN;

-- Add AI columns to app_settings table
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "defaultAiMode" "AiMode" NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "externalAiAccessMode" "ExternalAiAccessMode" NOT NULL DEFAULT 'WHITELIST';
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "monthlyAiTokenQuota" INTEGER NOT NULL DEFAULT 2000000;

-- Create ai_usage table
CREATE TABLE IF NOT EXISTS "ai_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "yearMonth" VARCHAR(7) NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "ai_usage_userId_idx" ON "ai_usage"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_userId_yearMonth_key" ON "ai_usage"("userId", "yearMonth");

-- Foreign key
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_userId_fkey') THEN
    ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================
-- RLS for ai_usage table
-- ============================================================

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage_user_isolation" ON "ai_usage";
CREATE POLICY "ai_usage_user_isolation" ON "ai_usage"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING ("userId" = current_setting('app.current_user_id', true))
    WITH CHECK ("userId" = current_setting('app.current_user_id', true));

-- Grant permissions to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_usage" TO retrospend_app;
