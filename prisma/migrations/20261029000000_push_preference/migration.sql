-- Push gets its own switch per notification type, and recurring items get a
-- type of their own.
-- 1. notification_preference."push": whether the type may push to a phone or
--    browser. Until now the in-app switch governed the push, so existing rows
--    start with the value of "inApp" and nobody's pushes change. A type with
--    no row still pushes (the default is on). The backfill runs only when the
--    column is added, so a re-run never undoes a later choice.
-- 2. NotificationType."RECURRING_DUE": the preference row for the "recurring
--    item is due" push, which had no row and so could not be turned off.
-- The table keeps its RLS policy and grants; a column adds nothing to them.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'RECURRING_DUE'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'NotificationType')
  ) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'RECURRING_DUE';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'notification_preference'
      AND column_name = 'push'
  ) THEN
    ALTER TABLE "notification_preference" ADD COLUMN "push" BOOLEAN;
    UPDATE "notification_preference" SET "push" = "inApp";
    ALTER TABLE "notification_preference" ALTER COLUMN "push" SET DEFAULT true;
    ALTER TABLE "notification_preference" ALTER COLUMN "push" SET NOT NULL;
  END IF;
END $$;
