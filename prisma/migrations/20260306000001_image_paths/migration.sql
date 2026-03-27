-- Add avatarPath to user table for profile picture storage paths
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "avatarPath" VARCHAR(500);

-- Add imagePath to project table for project cover image storage paths
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "imagePath" VARCHAR(500);
