-- AlterEnum
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'GUEST_UPGRADED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EventType')) THEN ALTER TYPE "EventType" ADD VALUE 'GUEST_UPGRADED'; END IF; END $$;
