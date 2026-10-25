-- Needs you "Later" (2E.2): a snoozed item stays out of Home's list until
-- "until", the start of the viewer's next day. Placeholder timestamp: the
-- orchestrator assigns the final one at merge.
-- "id" is made by the client and "updatedAt" is its version. "itemId" is the
-- item's stable id ("<type>:<entity id>"): ids only, never a title.
-- RLS: a user sees and writes only their own rows.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "needs_you_snooze" (
  "id"        TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "itemId"    VARCHAR(255) NOT NULL,
  "until"     TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "needs_you_snooze_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "needs_you_snooze_userId_itemId_key" ON "needs_you_snooze" ("userId", "itemId");
CREATE INDEX IF NOT EXISTS "needs_you_snooze_userId_until_idx" ON "needs_you_snooze" ("userId", "until");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'needs_you_snooze_userId_fkey') THEN
    ALTER TABLE "needs_you_snooze" ADD CONSTRAINT "needs_you_snooze_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "needs_you_snooze" TO retrospend_app;

ALTER TABLE "needs_you_snooze" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "needs_you_snooze" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS needs_you_snooze_isolation ON "needs_you_snooze";
CREATE POLICY needs_you_snooze_isolation ON "needs_you_snooze"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));
