-- AlterEnum
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PROFILE' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'Page')) THEN ALTER TYPE "Page" ADD VALUE 'PROFILE'; END IF; END $$;
