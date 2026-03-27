-- Add BIWEEKLY and QUARTERLY to RecurringFrequency enum
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'BIWEEKLY' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'RecurringFrequency')) THEN ALTER TYPE "RecurringFrequency" ADD VALUE 'BIWEEKLY'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'QUARTERLY' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'RecurringFrequency')) THEN ALTER TYPE "RecurringFrequency" ADD VALUE 'QUARTERLY'; END IF; END $$;
