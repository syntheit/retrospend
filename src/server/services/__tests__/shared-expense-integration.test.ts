/**
 * Shared expense shares convert at their own date's rate (batch 3, bug 7).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";
import { RATE_DATE, useRateTable } from "~/test/rate-table";
import {
	createStatefulDb,
	makeUserRef,
} from "../shared-expenses/test-utils";
import { SharedTransactionService } from "../shared-expenses/transaction.service";
import {
	getSharedExpenseShares,
	listSharedParticipationsForUser,
} from "../shared-expense-integration";

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

const MARCH = new Date("2026-03-15T12:00:00Z");

function participation(
	shareAmount: number,
	currency: string,
	exchangeRate: number | null,
	date = MARCH,
) {
	return {
		shareAmount,
		verificationStatus: "ACCEPTED",
		transaction: {
			id: `tx-${currency}-${shareAmount}`,
			description: "Dinner",
			amount: shareAmount * 2,
			currency,
			date,
			categoryId: null,
			category: null,
			exchangeRate,
			paidByType: "user",
			paidById: "user-1",
			projectId: null,
			createdByType: "user",
			createdById: "user-1",
			isLocked: false,
			splitParticipants: [],
		},
	};
}

describe("getSharedExpenseShares", () => {
	let db: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
	});

	it("a March ARS share uses the rate captured in March, not today's", async () => {
		db.splitParticipant.findMany.mockResolvedValue([
			participation(12000, "ARS", 1200),
		]);
		const [share] = await getSharedExpenseShares(db as never, "user-1");
		// 12,000 ARS at 1,200 = 10 USD (today's 1,560 would give 7.69)
		expect(share!.amountInUSD).toBe(10);
	});

	it("a legacy share without a captured rate uses the nearest rate for its date", async () => {
		db.splitParticipant.findMany.mockResolvedValue([
			participation(15600, "ARS", null),
		]);
		const [share] = await getSharedExpenseShares(db as never, "user-1");
		expect(share!.amountInUSD).toBe(10);
	});

	it("crypto shares multiply by USD per coin", async () => {
		db.splitParticipant.findMany.mockResolvedValue([
			participation(0.001, "BTC", 60000),
			participation(0.5, "ETH", null),
		]);
		const shares = await getSharedExpenseShares(db as never, "user-1");
		expect(shares.map((s) => s.amountInUSD)).toEqual([60, 958.31]);
	});

	it("a currency with no rate at all is not converted at 1", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.splitParticipant.findMany.mockResolvedValue([
			participation(1000, "XAU", null),
			participation(25, "USD", null),
		]);
		const shares = await getSharedExpenseShares(db as never, "user-1");
		expect(shares.map((s) => s.amountInUSD)).toEqual([0, 25]);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("keeps the category only when it is the participant's own", async () => {
		const own = participation(10, "USD", null);
		own.transaction = {
			...own.transaction,
			categoryId: "cat-mine" as never,
			category: { userId: "user-1" } as never,
		};
		const creators = participation(20, "USD", null);
		creators.transaction = {
			...creators.transaction,
			categoryId: "cat-theirs" as never,
			category: { userId: "user-2" } as never,
		};
		db.splitParticipant.findMany.mockResolvedValue([own, creators]);

		const shares = await getSharedExpenseShares(db as never, "user-1");

		expect(shares.map((s) => s.categoryId)).toEqual(["cat-mine", null]);
	});

	it("leaves out shares the user rejected, keeps pending ones", async () => {
		db.splitParticipant.findMany.mockResolvedValue([]);
		await getSharedExpenseShares(db as never, "user-1");
		const where = db.splitParticipant.findMany.mock.calls[0]?.[0]?.where;
		expect(where).toMatchObject({
			participantId: "user-1",
			verificationStatus: { not: "REJECTED" },
		});
	});
});

describe("listSharedParticipationsForUser", () => {
	it("reports each share's own rate and USD amount", async () => {
		const db = createMockDb();
		useRateTable(db);
		db.splitParticipant.findMany.mockResolvedValue([
			participation(12000, "ARS", 1200),
			participation(51.18, "BRL", null),
		]);
		const rows = await listSharedParticipationsForUser(db as never, "user-1");
		expect(rows.map((r) => [r.exchangeRate, r.amountInUSD])).toEqual([
			[1200, 10],
			[5.1178, 10],
		]);
	});
});

describe("SharedTransactionService captures the rate", () => {
	const alice = makeUserRef("alice");
	const bob = makeUserRef("bob");

	it("stores the rate on create and refreshes it when the currency changes", async () => {
		const db = createStatefulDb();
		const service = new SharedTransactionService(db as never, alice);

		const { transaction } = await service.create({
			amount: 0.003,
			currency: "BTC",
			description: "Node hosting",
			date: new Date(RATE_DATE),
			paidBy: alice,
			splitWith: [alice, bob, makeUserRef("carol")],
			splitMode: "EQUAL",
		});

		const stored = db._stores.transactions.get(transaction.id)!;
		expect(stored.exchangeRate).toBe(64545.9);
		const shares = [...db._stores.splits.values()].map((s) => s.shareAmount);
		expect(shares).toEqual([0.001, 0.001, 0.001]);

		await service.update({ id: transaction.id, currency: "EUR", amount: 30 });
		expect(db._stores.transactions.get(transaction.id)!.exchangeRate).toBe(0.8787);
	});
});
