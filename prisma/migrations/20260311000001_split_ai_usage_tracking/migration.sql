-- ============================================================
-- Split AI usage tracking: separate local vs external tokens
-- ============================================================

-- Add separate token tracking columns to ai_usage
ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "localTokensUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "externalTokensUsed" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing tokensUsed data was all from openrouter (external)
UPDATE "ai_usage" SET "externalTokensUsed" = "tokensUsed" WHERE "externalTokensUsed" = 0 AND "tokensUsed" > 0;

-- Add separate quota columns to app_settings
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "monthlyLocalAiTokenQuota" INTEGER NOT NULL DEFAULT 10000000;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "monthlyExternalAiTokenQuota" INTEGER NOT NULL DEFAULT 2000000;

-- Backfill: copy existing external quota if it was changed from default
UPDATE "app_settings" SET "monthlyExternalAiTokenQuota" = "monthlyAiTokenQuota" WHERE "monthlyExternalAiTokenQuota" = 2000000 AND "monthlyAiTokenQuota" != 2000000;
