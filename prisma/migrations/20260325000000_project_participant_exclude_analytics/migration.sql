-- Add per-user analytics exclusion to project_participant
ALTER TABLE "project_participant"
  ADD COLUMN IF NOT EXISTS "excludeFromAnalytics" BOOLEAN NOT NULL DEFAULT false;
