-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CategoryColor') THEN
  CREATE TYPE "CategoryColor" AS ENUM ('emerald', 'blue', 'sky', 'cyan', 'teal', 'orange', 'amber', 'violet', 'pink', 'fuchsia', 'indigo', 'slate', 'zinc', 'lime', 'neutral', 'gray', 'purple', 'yellow', 'stone', 'rose', 'red');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CategoryClickBehavior') THEN
  CREATE TYPE "CategoryClickBehavior" AS ENUM ('navigate', 'toggle');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CurrencySymbolStyle') THEN
  CREATE TYPE "CurrencySymbolStyle" AS ENUM ('native', 'standard');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
  CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExpenseStatus') THEN
  CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'FINALIZED');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecurringFrequency') THEN
  CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssetType') THEN
  CREATE TYPE "AssetType" AS ENUM ('CASH', 'INVESTMENT', 'CRYPTO', 'REAL_ESTATE', 'VEHICLE', 'LIABILITY_LOAN', 'LIABILITY_CREDIT_CARD', 'LIABILITY_MORTGAGE');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BudgetType') THEN
  CREATE TYPE "BudgetType" AS ENUM ('FIXED', 'PEG_TO_ACTUAL', 'PEG_TO_LAST_MONTH');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BudgetMode') THEN
  CREATE TYPE "BudgetMode" AS ENUM ('GLOBAL_LIMIT', 'SUM_OF_CATEGORIES');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Page') THEN
  CREATE TYPE "Page" AS ENUM ('DASHBOARD', 'BUDGET', 'ANALYTICS', 'WEALTH', 'EXCHANGE_RATES', 'SETTINGS', 'TABLE', 'ACCOUNT', 'INVITE_CODES', 'ADMIN', 'EXPENSE');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EventType') THEN
  CREATE TYPE "EventType" AS ENUM ('FAILED_LOGIN', 'SUCCESSFUL_LOGIN', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'ACCOUNT_CREATED', 'ACCOUNT_DELETED', 'ACCOUNT_ENABLED', 'ACCOUNT_DISABLED', 'INVITE_USED', 'INVITE_CREATED', 'EMAIL_VERIFIED', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'SETTINGS_UPDATED', 'USER_UPDATED', 'EXPENSE_IMPORT');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImportJobStatus') THEN
  CREATE TYPE "ImportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY_FOR_REVIEW', 'REVIEWING', 'COMPLETED', 'FAILED', 'CANCELLED');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImportJobType') THEN
  CREATE TYPE "ImportJobType" AS ENUM ('CSV', 'BANK_STATEMENT');
END IF; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" VARCHAR(2048),
    "homeCurrency" TEXT NOT NULL DEFAULT 'USD',
    "categoryClickBehavior" "CategoryClickBehavior" NOT NULL DEFAULT 'toggle',
    "budgetMode" "BudgetMode" NOT NULL DEFAULT 'GLOBAL_LIMIT',
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "currencySymbolStyle" "CurrencySymbolStyle" NOT NULL DEFAULT 'standard',
    "monthlyIncome" DECIMAL(10,2),
    "smartCurrencyFormatting" BOOLEAN NOT NULL DEFAULT true,
    "defaultPrivacyMode" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN DEFAULT false,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" VARCHAR(255),
    "userAgent" VARCHAR(255),
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL,
    "accountId" VARCHAR(191) NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" VARCHAR(2048),
    "refreshToken" VARCHAR(2048),
    "idToken" VARCHAR(2048),
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" VARCHAR(512),
    "password" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "verification_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "password_reset_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "expense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(19,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT,
    "amountInUSD" DECIMAL(12,2) NOT NULL,
    "exchangeRate" DECIMAL(10,4) NOT NULL,
    "pricingSource" TEXT NOT NULL,
    "location" VARCHAR(191),
    "description" VARCHAR(1000),
    "status" "ExpenseStatus" NOT NULL DEFAULT 'FINALIZED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isAmortizedParent" BOOLEAN NOT NULL DEFAULT false,
    "isAmortizedChild" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "recurringTemplateId" TEXT,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "category" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "color" "CategoryColor" NOT NULL,
    "icon" VARCHAR(32),
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "recurring_template" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "categoryId" TEXT,
    "frequency" "RecurringFrequency" NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "websiteUrl" VARCHAR(512),
    "paymentSource" VARCHAR(191),
    "autoPay" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_template_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "budget" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "period" TIMESTAMP(3) NOT NULL,
    "isRollover" BOOLEAN NOT NULL DEFAULT false,
    "rolloverAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pegToActual" BOOLEAN NOT NULL DEFAULT false,
    "type" "BudgetType" NOT NULL DEFAULT 'FIXED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "exchange_rate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT 'official',
    "rate" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "exchange_rate_favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchangeRateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_favorite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "asset_account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "currency" TEXT NOT NULL,
    "balance" DECIMAL(19,8) NOT NULL,
    "exchangeRate" DECIMAL(18,6),
    "exchangeRateType" VARCHAR(32),
    "isLiquid" BOOLEAN NOT NULL DEFAULT false,
    "interestRate" DOUBLE PRECISION,
    "minimumPayment" DECIMAL(10,2),
    "dueDate" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "asset_snapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(19,8) NOT NULL,
    "balanceInUSD" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "asset_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "asset_history" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "balance" DECIMAL(19,8) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invite_code" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "usedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_code_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'app_settings_singleton',
    "inviteOnlyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowAllUsersToGenerateInvites" BOOLEAN NOT NULL DEFAULT false,
    "enableEmail" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_page_setting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "page" "Page" NOT NULL,
    "settings" JSONB NOT NULL,

    CONSTRAINT "user_page_setting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "analytics_category_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "isFlexible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "analytics_category_preference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "system_status" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_status_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "event_log" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" "EventType" NOT NULL,
    "userId" TEXT,
    "ipAddress" VARCHAR(255),
    "userAgent" VARCHAR(255),
    "metadata" JSONB,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "import_job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "type" "ImportJobType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileData" TEXT,
    "transactions" JSONB,
    "warnings" JSONB,
    "errorMessage" VARCHAR(1000),
    "totalTransactions" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER,
    "skippedDuplicates" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "readyForReviewAt" TIMESTAMP(3),
    "reviewingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "progressPercent" DOUBLE PRECISION,
    "statusMessage" TEXT,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_username_key" ON "user"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_key" ON "user"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_key" ON "session"("token");
CREATE INDEX IF NOT EXISTS "session_expiresAt_idx" ON "session"("expiresAt");
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "account_providerId_accountId_key" ON "account"("providerId", "accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "account_providerId_userId_key" ON "account"("providerId", "userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification"("identifier");
CREATE UNIQUE INDEX IF NOT EXISTS "verification_token_token_key" ON "verification_token"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "verification_token_identifier_token_key" ON "verification_token"("identifier", "token");
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_token_token_key" ON "password_reset_token"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_token_identifier_token_key" ON "password_reset_token"("identifier", "token");
CREATE INDEX IF NOT EXISTS "expense_userId_date_idx" ON "expense"("userId", "date");
CREATE INDEX IF NOT EXISTS "expense_parentId_idx" ON "expense"("parentId");
CREATE INDEX IF NOT EXISTS "expense_recurringTemplateId_idx" ON "expense"("recurringTemplateId");
CREATE INDEX IF NOT EXISTS "expense_userId_date_title_amount_currency_idx" ON "expense"("userId", "date", "title", "amount", "currency");
CREATE INDEX IF NOT EXISTS "category_userId_idx" ON "category"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "category_name_userId_key" ON "category"("name", "userId");
CREATE INDEX IF NOT EXISTS "recurring_template_userId_nextDueDate_idx" ON "recurring_template"("userId", "nextDueDate");
CREATE INDEX IF NOT EXISTS "recurring_template_userId_isActive_idx" ON "recurring_template"("userId", "isActive");
CREATE INDEX IF NOT EXISTS "budget_userId_period_idx" ON "budget"("userId", "period");
CREATE UNIQUE INDEX IF NOT EXISTS "budget_userId_categoryId_period_key" ON "budget"("userId", "categoryId", "period");
CREATE INDEX IF NOT EXISTS "exchange_rate_currency_type_date_idx" ON "exchange_rate"("currency", "type", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rate_date_currency_type_key" ON "exchange_rate"("date", "currency", "type");
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rate_favorite_userId_exchangeRateId_key" ON "exchange_rate_favorite"("userId", "exchangeRateId");
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rate_favorite_userId_order_key" ON "exchange_rate_favorite"("userId", "order");
CREATE INDEX IF NOT EXISTS "asset_account_userId_idx" ON "asset_account"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "asset_snapshot_accountId_date_key" ON "asset_snapshot"("accountId", "date");
CREATE INDEX IF NOT EXISTS "asset_history_assetId_recordedAt_idx" ON "asset_history"("assetId", "recordedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "invite_code_code_key" ON "invite_code"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "user_page_setting_userId_page_key" ON "user_page_setting"("userId", "page");
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_category_preference_userId_categoryId_key" ON "analytics_category_preference"("userId", "categoryId");
CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON "twoFactor"("secret");
CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor"("userId");
CREATE INDEX IF NOT EXISTS "event_log_timestamp_idx" ON "event_log"("timestamp");
CREATE INDEX IF NOT EXISTS "event_log_userId_idx" ON "event_log"("userId");
CREATE INDEX IF NOT EXISTS "event_log_eventType_idx" ON "event_log"("eventType");
CREATE INDEX IF NOT EXISTS "import_job_userId_status_idx" ON "import_job"("userId", "status");
CREATE INDEX IF NOT EXISTS "import_job_userId_createdAt_idx" ON "import_job"("userId", "createdAt");

-- AddForeignKey (idempotent: drop if exists, then add)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_userId_fkey') THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_userId_fkey') THEN
    ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_parentId_fkey') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_recurringTemplateId_fkey') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "recurring_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_categoryId_fkey') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_userId_fkey') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_userId_fkey') THEN
    ALTER TABLE "category" ADD CONSTRAINT "category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_template_userId_fkey') THEN
    ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_template_categoryId_fkey') THEN
    ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_userId_fkey') THEN
    ALTER TABLE "budget" ADD CONSTRAINT "budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_categoryId_fkey') THEN
    ALTER TABLE "budget" ADD CONSTRAINT "budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exchange_rate_favorite_exchangeRateId_fkey') THEN
    ALTER TABLE "exchange_rate_favorite" ADD CONSTRAINT "exchange_rate_favorite_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "exchange_rate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exchange_rate_favorite_userId_fkey') THEN
    ALTER TABLE "exchange_rate_favorite" ADD CONSTRAINT "exchange_rate_favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_account_userId_fkey') THEN
    ALTER TABLE "asset_account" ADD CONSTRAINT "asset_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_snapshot_accountId_fkey') THEN
    ALTER TABLE "asset_snapshot" ADD CONSTRAINT "asset_snapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "asset_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_history_assetId_fkey') THEN
    ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invite_code_createdById_fkey') THEN
    ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invite_code_usedById_fkey') THEN
    ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_page_setting_userId_fkey') THEN
    ALTER TABLE "user_page_setting" ADD CONSTRAINT "user_page_setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_category_preference_userId_fkey') THEN
    ALTER TABLE "analytics_category_preference" ADD CONSTRAINT "analytics_category_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_category_preference_categoryId_fkey') THEN
    ALTER TABLE "analytics_category_preference" ADD CONSTRAINT "analytics_category_preference_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'twoFactor_userId_fkey') THEN
    ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_log_userId_fkey') THEN
    ALTER TABLE "event_log" ADD CONSTRAINT "event_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_job_userId_fkey') THEN
    ALTER TABLE "import_job" ADD CONSTRAINT "import_job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
