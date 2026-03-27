-- Add consent fields to User model
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "consentedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "consentVersion" VARCHAR(20);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "consentIp" VARCHAR(45);

-- Add new EventType values
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ADMIN_RESET_LINK_GENERATED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EventType')) THEN ALTER TYPE "EventType" ADD VALUE 'ADMIN_RESET_LINK_GENERATED'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ADMIN_AI_ACCESS_CHANGED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EventType')) THEN ALTER TYPE "EventType" ADD VALUE 'ADMIN_AI_ACCESS_CHANGED'; END IF; END $$;
