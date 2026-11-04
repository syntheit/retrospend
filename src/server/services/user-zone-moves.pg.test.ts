/**
 * Wealth moves that date by the user's day, with no zone in the input, on
 * real Postgres. The instant 2026-11-03T02:00Z is Nov 3 in UTC but still
 * Nov 2, 23:00 in Buenos Aires (UTC-3). A move without an input zone reads
 * the user's saved zone, never the server process's; an explicit zone wins.
 * ARS home; the rates are set per day so each day's value is hand-derived.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { openAccount, seedArsRatesOn } from "./accounts/test-fixtures";
import { setRateType } from "./accounts/rate-type.mutation";
import { addIncome } from "./income/add.mutation";
import { deleteIncome } from "./income/delete.mutation";
import { moveIn } from "./income/move-in.mutation";
import { createTransfer } from "./transfers/create.mutation";

const INSTANT = new Date("2026-11-03T02:00:00Z");
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const NOV_2 = new Date("2026-11-02T00:00:00Z");
const NOV_3 = new Date("2026-11-03T00:00:00Z");

// ARS per USD, different on the two days so a wrong day shows in the value.
const RATES = [
	[NOV_2, "blue", "1468"],
	[NOV_2, "official", "1412"],
	[NOV_2, "mep", "1449"],
	[NOV_3, "blue", "1500"],
	[NOV_3, "official", "1450"],
	[NOV_3, "mep", "1480"],
] as const;

let dropRates: () => Promise<unknown>;
beforeAll(async () => {
	dropRates = await seedArsRatesOn(RATES);
});

afterAll(() => dropRates());

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
});

afterEach(() => {
	vi.useRealTimers();
});

async function buenosAiresUser() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "ARS", timeZone: BUENOS_AIRES },
	});
	return user.id;
}

describe("transfer.create", () => {
	async function move(timeZone?: string) {
		const userId = await buenosAiresUser();
		const savings = await openAccount(userId, "Savings", "CASH", "ARS", 5_000_000);
		const wallet = await openAccount(userId, "Wallet", "CASH", "ARS", 1_000_000);
		const { value } = await forUser(userId).apply(createTransfer, {
			fromAccountId: savings,
			toAccountId: wallet,
			fromAmount: "300000",
			fee: { amount: "1500" },
			...(timeZone ? { timeZone } : {}),
		});
		const transfer = await adminDb.transfer.findUniqueOrThrow({
			where: { id: value.transferId },
			include: { feeExpense: { select: { date: true } } },
		});
		return transfer;
	}

	it("dates the move and its fee on the saved zone's day: Nov 2 in Buenos Aires", async () => {
		const transfer = await move();
		expect(transfer.date).toEqual(NOV_2);
		// The fee is an expense row: that day's midnight in the zone.
		expect(transfer.feeExpense?.date).toEqual(new Date("2026-11-02T03:00:00Z"));
	});

	it("dates both on the input zone's day when one is given", async () => {
		const transfer = await move("UTC");
		expect(transfer.date).toEqual(NOV_3);
		expect(transfer.feeExpense?.date).toEqual(NOV_3);
	});
});

describe("account.setRateType", () => {
	// 100 USD at Blue 1,468 is ARS 146,800; at Official 1,412 it is 141,200
	// (Nov 2). On Nov 3: 150,000 and 145,000.
	async function switchTo(timeZone?: string) {
		const userId = await buenosAiresUser();
		const accountId = await openAccount(userId, "USD cash", "CASH", "USD", 100, {
			exchangeRateType: "blue",
		});
		const { value } = await forUser(userId).apply(setRateType, {
			accountId,
			rateType: "official",
			...(timeZone ? { timeZone } : {}),
		});
		return value;
	}

	it("switches on the saved zone's day: Nov 2, revalued -ARS 5,600", async () => {
		const value = await switchTo();
		expect(value.from).toBe("2026-11-02");
		expect(value.revaluation).toEqual({ minor: -560_000, currency: "ARS" });
	});

	it("switches on the input zone's day when one is given: Nov 3, -ARS 5,000", async () => {
		const value = await switchTo("UTC");
		expect(value.from).toBe("2026-11-03");
		expect(value.revaluation).toEqual({ minor: -500_000, currency: "ARS" });
	});
});

describe("income.moveIn", () => {
	async function movedAt(addZone: string, moveZone?: string) {
		const userId = await buenosAiresUser();
		const wise = await openAccount(userId, "Wise", "INVESTMENT", "USD", 1840.55, {
			exchangeRateType: "official",
		});
		const { value: income } = await forUser(userId).apply(addIncome, {
			title: "Estudio Norte",
			amount: "2000",
			currency: "USD",
			rateType: "mep",
			into: wise,
			timeZone: addZone,
		});
		await forUser(userId).apply(moveIn, {
			expenseId: income.expenseId,
			...(moveZone ? { timeZone: moveZone } : {}),
		});
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: income.expenseId },
		});
		return row.movedInAt;
	}

	it("moves in on the saved zone's day: Nov 2, midnight in Buenos Aires", async () => {
		expect(await movedAt(BUENOS_AIRES)).toEqual(new Date("2026-11-02T03:00:00Z"));
	});

	it("moves in on the input zone's day when one is given", async () => {
		expect(await movedAt("UTC", "UTC")).toEqual(NOV_3);
	});
});

describe("income.delete", () => {
	// The row sits at Nov 2, 22:00 in Buenos Aires, which is Nov 3 in UTC.
	const lateRow = new Date("2026-11-03T01:00:00Z");

	async function recreatedDate(timeZone?: string) {
		const userId = await buenosAiresUser();
		const { value } = await forUser(userId).apply(addIncome, {
			title: "Gift",
			amount: "1000",
			currency: "ARS",
		});
		await adminDb.expense.update({
			where: { id: value.expenseId },
			data: { date: lateRow },
		});
		const deleted = await forUser(userId).apply(deleteIncome, {
			expenseId: value.expenseId,
			...(timeZone ? { timeZone } : {}),
		});
		return deleted.value.recreate.date;
	}

	it("reads the row's day in the saved zone: Nov 2", async () => {
		expect(await recreatedDate()).toBe("2026-11-02");
	});

	it("reads the row's day in the input zone when one is given", async () => {
		expect(await recreatedDate("UTC")).toBe("2026-11-03");
	});
});
