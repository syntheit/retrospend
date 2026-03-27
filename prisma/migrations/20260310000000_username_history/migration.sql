-- AlterTable
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "lastUsernameChangeAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "username_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousUsername" VARCHAR(64) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "username_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "username_history_previousUsername_key" ON "username_history"("previousUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "username_history_userId_idx" ON "username_history"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "username_history_changedAt_idx" ON "username_history"("changedAt");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'username_history_userId_fkey') THEN ALTER TABLE "username_history" ADD CONSTRAINT "username_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AlterEnum
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'USERNAME_CHANGED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EventType')) THEN ALTER TYPE "EventType" ADD VALUE 'USERNAME_CHANGED'; END IF; END $$;
