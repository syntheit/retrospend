-- Remove SETTLED from ProjectStatus enum, converting existing SETTLED projects to ACTIVE.
-- PostgreSQL doesn't support removing enum values directly, so we:
-- 1. Convert any SETTLED projects to ACTIVE
-- 2. Create a new enum type without SETTLED
-- 3. Swap the column to use the new type
-- 4. Drop the old type and rename the new one

-- Step 1: Convert existing SETTLED projects to ACTIVE
UPDATE "Project" SET status = 'ACTIVE' WHERE status = 'SETTLED';

-- Step 2: Only perform the enum swap if SETTLED still exists in the type
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SETTLED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ProjectStatus')
  ) THEN
    -- Create new enum without SETTLED
    CREATE TYPE "ProjectStatus_new" AS ENUM ('ACTIVE', 'ARCHIVED');

    -- Alter column to use new enum
    ALTER TABLE "Project"
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "ProjectStatus_new" USING (status::text::"ProjectStatus_new"),
      ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

    -- Drop old enum and rename
    DROP TYPE "ProjectStatus";
    ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";
  END IF;
END $$;
