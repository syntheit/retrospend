-- Add hasUnseenChanges to split_participant
-- Tracks whether a participant has unseen edits on a shared transaction.
-- Set to true when another participant edits the transaction; cleared when
-- the participant views the revision history.

ALTER TABLE "split_participant" ADD COLUMN IF NOT EXISTS "hasUnseenChanges" BOOLEAN NOT NULL DEFAULT false;
