-- ============================================================
-- AI Provider Support: enums, user/app_settings columns, ai_usage table
-- ============================================================

-- Create enums
CREATE TYPE "AiMode" AS ENUM ('LOCAL', 'EXTERNAL');
CREATE TYPE "ExternalAiAccessMode" AS ENUM ('WHITELIST', 'BLACKLIST');

-- Add AI columns to user table
ALTER TABLE "user" ADD COLUMN "aiMode" "AiMode" NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "user" ADD COLUMN "externalAiAllowed" BOOLEAN;

-- Add AI columns to app_settings table
ALTER TABLE "app_settings" ADD COLUMN "defaultAiMode" "AiMode" NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "app_settings" ADD COLUMN "externalAiAccessMode" "ExternalAiAccessMode" NOT NULL DEFAULT 'WHITELIST';
ALTER TABLE "app_settings" ADD COLUMN "monthlyAiTokenQuota" INTEGER NOT NULL DEFAULT 2000000;

-- Create ai_usage table
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "yearMonth" VARCHAR(7) NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "ai_usage_userId_idx" ON "ai_usage"("userId");
CREATE UNIQUE INDEX "ai_usage_userId_yearMonth_key" ON "ai_usage"("userId", "yearMonth");

-- Foreign key
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- RLS for ai_usage table
-- ============================================================

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_user_isolation" ON "ai_usage"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING ("userId" = current_setting('app.current_user_id', true))
    WITH CHECK ("userId" = current_setting('app.current_user_id', true));

-- Grant permissions to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_usage" TO retrospend_app;
