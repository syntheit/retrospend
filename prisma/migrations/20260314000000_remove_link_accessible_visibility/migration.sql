-- Migration: Remove LINK_ACCESSIBLE from ProjectVisibility enum
-- Any projects currently set to LINK_ACCESSIBLE are migrated to PUBLIC.
-- Wrapped in a guard so it's idempotent (skips if LINK_ACCESSIBLE already removed).

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'LINK_ACCESSIBLE' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ProjectVisibility')) THEN

-- Step 1: Migrate existing LINK_ACCESSIBLE projects to PUBLIC
UPDATE "project"
SET "visibility" = 'PUBLIC'::"ProjectVisibility"
WHERE "visibility" = 'LINK_ACCESSIBLE'::"ProjectVisibility";

-- Step 2: Drop the column default before altering the type
ALTER TABLE "project" ALTER COLUMN "visibility" DROP DEFAULT;

-- Step 3: Remove LINK_ACCESSIBLE from the enum
ALTER TYPE "ProjectVisibility" RENAME TO "ProjectVisibility_old";

CREATE TYPE "ProjectVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

ALTER TABLE "project"
  ALTER COLUMN "visibility" TYPE "ProjectVisibility"
  USING "visibility"::text::"ProjectVisibility";

-- Step 4: Re-add the default with the new type
ALTER TABLE "project"
  ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE'::"ProjectVisibility";

DROP TYPE "ProjectVisibility_old";

END IF; END $$;
