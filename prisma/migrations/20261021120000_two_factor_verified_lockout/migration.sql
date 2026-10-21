-- better-auth's twoFactor plugin writes these columns. "verified" has been
-- part of its schema since before 1.7 and was missing here, so enabling 2FA
-- failed with an unknown argument error. 1.7 adds account lockout after
-- repeated failed codes, which writes "failedVerificationCount" and
-- "lockedUntil". All three are nullable with the plugin's defaults, so
-- existing rows count as verified and unlocked.

ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "failedVerificationCount" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "verified" BOOLEAN DEFAULT true;
