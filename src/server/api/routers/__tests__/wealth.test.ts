/**
 * Wealth router (batch 4): runway counts spending once and only what counts
 * toward analytics; closing, reopening, deleting and exporting accounts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExpenseTable } from "~/test/expense-table";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";

const mockDb = vi.hoisted(() => ({}) as ReturnType<typeof createMockDb>);

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));

vi.mock("~/server/db", () => ({
	db: mockDb as never,
	createUserScopedDb: vi.fn(() => mockDb),
}));

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { callAndFlush, makeSession } from "~/test/trpc-test-utils";
import { wealthRouter } from "../wealth";

const createCaller = createCallerFactory(wealthRouter);
const caller = () =>
	createCaller({
		session: makeSession({ id: "user-1" }),
		db: mockDb as never,
		headers: new Headers(),
	});

const NOW = new Date(2026, 9, 21, 12);
const ASSET_ID = "classet00000000000000001";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.clearAllMocks();
	Object.assign(mockDb, createMockDb());
	useRateTable(mockDb);
	mockDb.expense.findFirst.mockResolvedValue({ date: new Date(2025, 0, 1) });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("getRunwayStats", () => {
	it("counts an amortized purchase once and skips excluded and draft expenses", async () => {
		useExpenseTable(mockDb, [
			// 600 USD laptop spread over 6 months: parent + 6 children of 100
			{
				date: new Date(2026, 4, 1),
				amount: 600,
				currency: "USD",
				amountInUSD: 600,
				isAmortizedParent: true,
			},
			...[4, 5, 6, 7, 8, 9].map((m) => ({
				date: new Date(2026, m, 1),
				amount: 100,
				currency: "USD",
				amountInUSD: 100,
				isAmortizedChild: true,
			})),
			{
				date: new Date(2026, 8, 3),
				amount: 900,
				currency: "USD",
				amountInUSD: 900,
				excludeFromAnalytics: true,
			},
			{
				date: new Date(2026, 8, 4),
				amount: 700,
				currency: "USD",
				amountInUSD: 700,
				status: "DRAFT",
			},
			{
				date: new Date(2026, 8, 5),
				amount: 300,
				currency: "USD",
				amountInUSD: 300,
			},
		]);

		const result = await callAndFlush(() =>
			caller().getRunwayStats({ currency: "USD" }),
		);

		expect(result.monthsActive).toBe(6);
		expect(result.averageMonthlySpend).toBeCloseTo((600 + 300) / 6);
	});

	it("ARS: ARS spending as entered, USD at the ARS rate", async () => {
		useExpenseTable(mockDb, [
			{
				date: new Date(2026, 8, 1),
				amount: 600000,
				currency: "ARS",
				amountInUSD: 600,
			},
			{
				date: new Date(2026, 8, 2),
				amount: 100,
				currency: "USD",
				amountInUSD: 100,
			},
		]);

		const result = await callAndFlush(() =>
			caller().getRunwayStats({ currency: "ARS" }),
		);

		expect(result.averageMonthlySpend).toBeCloseTo((600000 + 100 * 1560) / 6);
	});
});

// updateAssetBalance runs account.updateBalance through the preview runner on
// real Postgres now: src/server/services/accounts/accounts.pg.test.ts.

describe("closing and deleting accounts", () => {
	const openAccount = {
		id: ASSET_ID,
		userId: "user-1",
		currency: "ARS",
		type: "CASH",
		balance: 1560000,
		exchangeRate: 1560,
		exchangeRateType: "blue",
		closedAt: null,
	};
	const today = new Date(Date.UTC(2026, 9, 21));

	type SnapshotCall = {
		where: { accountId_date: { accountId: string; date: Date } };
		create: Record<string, unknown>;
		update: Record<string, unknown>;
	};
	const snapshotCall = () =>
		mockDb.assetSnapshot.upsert.mock.calls[0]![0] as SnapshotCall;

	it("closeAsset sets closedAt and records a zero snapshot for today", async () => {
		mockDb.assetAccount.findFirst.mockResolvedValue(openAccount);
		mockDb.assetAccount.update.mockResolvedValue({ id: ASSET_ID });

		await callAndFlush(() => caller().closeAsset({ id: ASSET_ID }));

		expect(mockDb.assetAccount.findFirst).toHaveBeenCalledWith({
			where: { id: ASSET_ID, userId: "user-1" },
		});
		expect(mockDb.assetAccount.update).toHaveBeenCalledWith({
			where: { id: ASSET_ID },
			data: { closedAt: expect.any(Date) },
		});
		expect(snapshotCall().where.accountId_date).toEqual({
			accountId: ASSET_ID,
			date: today,
		});
		expect(snapshotCall().create).toMatchObject({
			balance: 0,
			balanceInUSD: 0,
			currency: "ARS",
			type: "CASH",
			exchangeRateType: "blue",
		});
		// The account and its past snapshots stay
		expect(mockDb.assetAccount.deleteMany).not.toHaveBeenCalled();
		expect(mockDb.assetSnapshot.deleteMany).not.toHaveBeenCalled();
	});

	it("closeAsset on an account of another user is NOT_FOUND", async () => {
		mockDb.assetAccount.findFirst.mockResolvedValue(null);

		await expect(
			callAndFlush(() => caller().closeAsset({ id: ASSET_ID })),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(mockDb.assetAccount.update).not.toHaveBeenCalled();
	});

	it("reopenAsset clears closedAt and records the kept balance for today", async () => {
		mockDb.assetAccount.findFirst.mockResolvedValue({
			...openAccount,
			closedAt: new Date(2026, 8, 1),
		});
		mockDb.assetAccount.update.mockResolvedValue({ id: ASSET_ID });

		await callAndFlush(() => caller().reopenAsset({ id: ASSET_ID }));

		expect(mockDb.assetAccount.update).toHaveBeenCalledWith({
			where: { id: ASSET_ID },
			data: { closedAt: null },
		});
		expect(snapshotCall().where.accountId_date.date).toEqual(today);
		expect(snapshotCall().create).toMatchObject({ balance: 1560000 });
		expect(snapshotCall().create.balanceInUSD as number).toBeCloseTo(1000);
	});

	it("deleteAssetPermanently deletes the account, scoped to the user", async () => {
		mockDb.assetAccount.deleteMany.mockResolvedValue({ count: 1 });

		await callAndFlush(() => caller().deleteAssetPermanently({ id: ASSET_ID }));

		expect(mockDb.assetAccount.deleteMany).toHaveBeenCalledWith({
			where: { id: ASSET_ID, userId: "user-1" },
		});
	});

	it("deleteAssetPermanently of a missing account is NOT_FOUND", async () => {
		mockDb.assetAccount.deleteMany.mockResolvedValue({ count: 0 });

		await expect(
			callAndFlush(() => caller().deleteAssetPermanently({ id: ASSET_ID })),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("a permanent delete erases the balance history with the account", () => {
		// Snapshots and history rows go through the cascade on their account.
		const schema = readFileSync(
			join(process.cwd(), "prisma/schema.prisma"),
			"utf8",
		);
		const model = (name: string) =>
			new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`).exec(schema)?.[0] ?? "";
		expect(model("AssetSnapshot")).toMatch(
			/account\s+AssetAccount\s+@relation\([^)]*onDelete: Cascade\)/,
		);
		expect(model("AssetHistory")).toMatch(
			/asset\s+AssetAccount\s+@relation\([^)]*onDelete: Cascade\)/,
		);
	});

	it("exportCsv leaves closed accounts out", async () => {
		await callAndFlush(() => caller().exportCsv());

		expect(mockDb.assetAccount.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { userId: "user-1", closedAt: null },
			}),
		);
	});
});
