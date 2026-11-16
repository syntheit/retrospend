-- Advanced protection state of an account. OFF for everyone; ON means the
-- account is protected and the server refuses routes that touch its ledger.
-- Only OFF and ON exist here. Later transitional states are added with
-- ALTER TYPE ... ADD VALUE, and the guard refuses anything other than OFF.
--
-- No grant and no policy change: "user" already has row-level security and
-- column grants, and this column is simply not granted to retrospend_app. It
-- is written and read on the owner connection only, like "role".

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProtectionState') THEN
    CREATE TYPE "ProtectionState" AS ENUM ('OFF', 'ON');
  END IF;
END $$;

-- A constant default is metadata only, so no table rewrite.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "protectionState" "ProtectionState" NOT NULL DEFAULT 'OFF';
