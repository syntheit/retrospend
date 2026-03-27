-- Drop unused expiresAt column that was created NOT NULL without a default,
-- causing null constraint violations on guestSession.create().
-- The column is not present in the Prisma schema and not used anywhere in code.
ALTER TABLE "guest_session" DROP COLUMN IF EXISTS "expiresAt";

-- Also drop updatedAt which is not in the Prisma schema (lastActiveAt replaced it).
ALTER TABLE "guest_session" DROP COLUMN IF EXISTS "updatedAt";
