-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CategoryColor" AS ENUM ('emerald', 'blue', 'sky', 'cyan', 'teal', 'orange', 'amber', 'violet', 'pink', 'fuchsia', 'indigo', 'slate', 'zinc', 'lime', 'neutral', 'gray', 'purple', 'yellow', 'stone', 'rose', 'red');

-- CreateEnum
CREATE TYPE "CategoryClickBehavior" AS ENUM ('navigate', 'toggle');

-- CreateEnum
CREATE TYPE "CurrencySymbolStyle" AS ENUM ('native', 'standard');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('CASH', 'INVESTMENT', 'CRYPTO', 'REAL_ESTATE', 'VEHICLE', 'LIABILITY_LOAN', 'LIABILITY_CREDIT_CARD', 'LIABILITY_MORTGAGE');

-- CreateEnum
CREATE TYPE "BudgetType" AS ENUM ('FIXED', 'PEG_TO_ACTUAL', 'PEG_TO_LAST_MONTH');

-- CreateEnum
CREATE TYPE "BudgetMode" AS ENUM ('GLOBAL_LIMIT', 'SUM_OF_CATEGORIES');

-- CreateEnum
CREATE TYPE "Page" AS ENUM ('DASHBOARD', 'BUDGET', 'ANALYTICS', 'WEALTH', 'EXCHANGE_RATES', 'SETTINGS', 'TABLE', 'ACCOUNT', 'INVITE_CODES', 'ADMIN', 'EXPENSE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('FAILED_LOGIN', 'SUCCESSFUL_LOGIN', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'ACCOUNT_CREATED', 'ACCOUNT_DELETED', 'ACCOUNT_ENABLED', 'ACCOUNT_DISABLED', 'INVITE_USED', 'INVITE_CREATED', 'EMAIL_VERIFIED', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'SETTINGS_UPDATED', 'USER_UPDATED', 'EXPENSE_IMPORT');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY_FOR_REVIEW', 'REVIEWING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportJobType" AS ENUM ('CSV', 'BANK_STATEMENT');

-- CreateTable
CREATE TABLE "user" (
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

-- CreateTable
CREATE TABLE "session" (
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

-- CreateTable
CREATE TABLE "account" (
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

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "password_reset_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "expense" (
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

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "color" "CategoryColor" NOT NULL,
    "icon" VARCHAR(32),
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_template" (
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

-- CreateTable
CREATE TABLE "budget" (
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

-- CreateTable
CREATE TABLE "exchange_rate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT 'official',
    "rate" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate_favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchangeRateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_account" (
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

-- CreateTable
CREATE TABLE "asset_snapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(19,8) NOT NULL,
    "balanceInUSD" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "asset_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_history" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "balance" DECIMAL(19,8) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_code" (
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

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'app_settings_singleton',
    "inviteOnlyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowAllUsersToGenerateInvites" BOOLEAN NOT NULL DEFAULT false,
    "enableEmail" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_page_setting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "page" "Page" NOT NULL,
    "settings" JSONB NOT NULL,

    CONSTRAINT "user_page_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_category_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "isFlexible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "analytics_category_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_status" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_status_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_log" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" "EventType" NOT NULL,
    "userId" TEXT,
    "ipAddress" VARCHAR(255),
    "userAgent" VARCHAR(255),
    "metadata" JSONB,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
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
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_userId_key" ON "account"("providerId", "userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_token_key" ON "verification_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_identifier_token_key" ON "verification_token"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_token_key" ON "password_reset_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_identifier_token_key" ON "password_reset_token"("identifier", "token");

-- CreateIndex
CREATE INDEX "expense_userId_date_idx" ON "expense"("userId", "date");

-- CreateIndex
CREATE INDEX "expense_parentId_idx" ON "expense"("parentId");

-- CreateIndex
CREATE INDEX "expense_recurringTemplateId_idx" ON "expense"("recurringTemplateId");

-- CreateIndex
CREATE INDEX "expense_userId_date_title_amount_currency_idx" ON "expense"("userId", "date", "title", "amount", "currency");

-- CreateIndex
CREATE INDEX "category_userId_idx" ON "category"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "category_name_userId_key" ON "category"("name", "userId");

-- CreateIndex
CREATE INDEX "recurring_template_userId_nextDueDate_idx" ON "recurring_template"("userId", "nextDueDate");

-- CreateIndex
CREATE INDEX "recurring_template_userId_isActive_idx" ON "recurring_template"("userId", "isActive");

-- CreateIndex
CREATE INDEX "budget_userId_period_idx" ON "budget"("userId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "budget_userId_categoryId_period_key" ON "budget"("userId", "categoryId", "period");

-- CreateIndex
CREATE INDEX "exchange_rate_currency_type_date_idx" ON "exchange_rate"("currency", "type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rate_date_currency_type_key" ON "exchange_rate"("date", "currency", "type");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rate_favorite_userId_exchangeRateId_key" ON "exchange_rate_favorite"("userId", "exchangeRateId");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rate_favorite_userId_order_key" ON "exchange_rate_favorite"("userId", "order");

-- CreateIndex
CREATE INDEX "asset_account_userId_idx" ON "asset_account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_snapshot_accountId_date_key" ON "asset_snapshot"("accountId", "date");

-- CreateIndex
CREATE INDEX "asset_history_assetId_recordedAt_idx" ON "asset_history"("assetId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invite_code_code_key" ON "invite_code"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_page_setting_userId_page_key" ON "user_page_setting"("userId", "page");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_category_preference_userId_categoryId_key" ON "analytics_category_preference"("userId", "categoryId");

-- CreateIndex
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor"("secret");

-- CreateIndex
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor"("userId");

-- CreateIndex
CREATE INDEX "event_log_timestamp_idx" ON "event_log"("timestamp");

-- CreateIndex
CREATE INDEX "event_log_userId_idx" ON "event_log"("userId");

-- CreateIndex
CREATE INDEX "event_log_eventType_idx" ON "event_log"("eventType");

-- CreateIndex
CREATE INDEX "import_job_userId_status_idx" ON "import_job"("userId", "status");

-- CreateIndex
CREATE INDEX "import_job_userId_createdAt_idx" ON "import_job"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "recurring_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_favorite" ADD CONSTRAINT "exchange_rate_favorite_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "exchange_rate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_favorite" ADD CONSTRAINT "exchange_rate_favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_account" ADD CONSTRAINT "asset_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_snapshot" ADD CONSTRAINT "asset_snapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "asset_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_page_setting" ADD CONSTRAINT "user_page_setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_category_preference" ADD CONSTRAINT "analytics_category_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_category_preference" ADD CONSTRAINT "analytics_category_preference_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
