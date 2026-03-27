-- ============================================================
-- Payment Methods: enum
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethodVisibility') THEN
    CREATE TYPE "PaymentMethodVisibility" AS ENUM ('PUBLIC', 'FRIENDS_ONLY', 'PAYMENT_ONLY');
  END IF;
END $$;

-- ============================================================
-- Payment Methods: table
-- ============================================================

CREATE TABLE IF NOT EXISTS "payment_method" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "type"       VARCHAR(50) NOT NULL,
  "label"      VARCHAR(100),
  "identifier" VARCHAR(500),
  "rank"       INTEGER NOT NULL,
  "visibility" "PaymentMethodVisibility" NOT NULL DEFAULT 'PAYMENT_ONLY',
  "minAmount"  DECIMAL(19, 8),
  "currency"   VARCHAR(10),
  "network"    VARCHAR(50),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_method_pkey" PRIMARY KEY ("id")
);

-- Foreign key (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_method_userId_fkey') THEN
    ALTER TABLE "payment_method"
      ADD CONSTRAINT "payment_method_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Index
CREATE INDEX IF NOT EXISTS "payment_method_userId_idx" ON "payment_method"("userId");

-- ============================================================
-- Payment Methods: RLS
-- ============================================================

ALTER TABLE "payment_method" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_method" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_method_isolation ON "payment_method";
CREATE POLICY payment_method_isolation ON "payment_method"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));
