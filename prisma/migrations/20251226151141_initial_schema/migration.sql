Retrospend dev shell ready (Prisma engines from /nix/store/3fq3ncqbcawrcx55am12chibqnr0f9ab-prisma-engines-7.2.0)
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CategoryColor" AS ENUM ('emerald', 'blue', 'sky', 'cyan', 'teal', 'orange', 'amber', 'violet', 'pink', 'fuchsia', 'indigo', 'slate', 'zinc', 'lime', 'neutral', 'gray', 'purple', 'yellow', 'stone', 'rose', 'red');

-- CreateEnum
CREATE TYPE "CategoryClickBehavior" AS ENUM ('navigate', 'toggle');

-- CreateEnum
CREATE TYPE "FontPreference" AS ENUM ('sans', 'mono');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('CASH', 'INVESTMENT', 'CRYPTO', 'REAL_ESTATE');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" VARCHAR(2048),
    "homeCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "defaultCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "categoryClickBehavior" "CategoryClickBehavior" NOT NULL DEFAULT 'toggle',
    "fontPreference" "FontPreference" NOT NULL DEFAULT 'sans',
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "color" "CategoryColor" NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
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
    "allowAllUsersToGenerateInvites" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_userId_key" ON "account"("providerId", "userId");

-- CreateIndex
CREATE INDEX "expense_userId_date_idx" ON "expense"("userId", "date");

-- CreateIndex
CREATE INDEX "category_userId_idx" ON "category"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "category_name_userId_key" ON "category"("name", "userId");

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
CREATE UNIQUE INDEX "invite_code_code_key" ON "invite_code"("code");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_favorite" ADD CONSTRAINT "exchange_rate_favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_favorite" ADD CONSTRAINT "exchange_rate_favorite_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "exchange_rate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_account" ADD CONSTRAINT "asset_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_snapshot" ADD CONSTRAINT "asset_snapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "asset_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

