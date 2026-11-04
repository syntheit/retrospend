/**
 * Money writes that date by the user's day, with no zone in the input, on real
 * Postgres. The instant 2026-11-03T02:00Z is Nov 3 in UTC but still Nov 2,
 * 23:00 in Buenos Aires (UTC-3). A write without an input zone reads the
 * user's saved zone (userTimeZone), never the server process's; an explicit
 * zone still wins.
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
import { updateBalance } from "./accounts/update-balance.mutation";
import { addIncome } from "./income/add.mutation";
import { skipRecurring } from "./recurring-skip.mutation";

const INSTANT = new Date("2026-11-03T02:00:00Z");
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";

// A rate on each day, so an income booked on either has one.
let dropRates: () => Promise<unknown>;
beforeAll(async () => {
	dropRates = await seedArsRatesOn([
		[new Date("2026-11-02T00:00:00Z"), "blue", "1468"],
		[new Date("2026-11-03T00:00:00Z"), "blue", "1468"],
	]);
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

describe("recurring.skip", () => {
	// Due Nov 3 at 00:00 in Buenos Aires (03:00Z), an hour after the instant.
	const dueDate = new Date("2026-11-03T03:00:00Z");

	async function template(userId: string) {
		return adminDb.recurringTemplate.create({
			data: {
				userId,
				name: "Rent",
				amount: "1000",
				currency: "ARS",
				frequency: "MONTHLY",
				nextDueDate: dueDate,
			},
		});
	}

	it("is not due yet for a Buenos Aires user: Nov 2, 23:00 there", async () => {
		const userId = await buenosAiresUser();
		const { id } = await template(userId);
		await expect(
			forUser(userId).apply(skipRecurring, { templateId: id }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const row = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(row.nextDueDate).toEqual(dueDate);
	});

	it("is due when the input zone says it is Nov 3 there", async () => {
		const userId = await buenosAiresUser();
		const { id } = await template(userId);
		const { value } = await forUser(userId).apply(skipRecurring, {
			templateId: id,
			timeZone: "Asia/Tokyo",
		});
		expect(value.dueAt).toEqual(dueDate);
	});
});

describe("income.add", () => {
	const rowDateFor = async (userId: string, timeZone?: string) => {
		const { value } = await forUser(userId).apply(addIncome, {
			title: "Gift",
			amount: "1000",
			currency: "ARS",
			...(timeZone ? { timeZone } : {}),
		});
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: value.expenseId },
		});
		return row.date;
	};

	it("dates the row on the saved zone's day: Nov 2 midnight in Buenos Aires", async () => {
		expect(await rowDateFor(await buenosAiresUser())).toEqual(
			new Date("2026-11-02T03:00:00Z"),
		);
	});

	it("dates the row on the input zone's day when one is given", async () => {
		expect(await rowDateFor(await buenosAiresUser(), "UTC")).toEqual(
			new Date("2026-11-03T00:00:00Z"),
		);
	});
});

describe("account.updateBalance", () => {
	const latestSnapshotDay = async (accountId: string) => {
		const rows = await adminDb.assetSnapshot.findMany({
			where: { accountId },
			orderBy: { date: "desc" },
			take: 1,
		});
		return rows[0]?.date.toISOString().slice(0, 10);
	};

	async function update(timeZone?: string) {
		const userId = await buenosAiresUser();
		const id = await openAccount(userId, "Savings", "CASH", "ARS", 1000, {
			exchangeRateType: "custom",
			exchangeRate: 2000,
		});
		await forUser(userId).apply(updateBalance, {
			accountId: id,
			balance: "1500",
			...(timeZone ? { timeZone } : {}),
		});
		return latestSnapshotDay(id);
	}

	it("checkpoints on the saved zone's day: Nov 2", async () => {
		expect(await update()).toBe("2026-11-02");
	});

	it("checkpoints on the input zone's day when one is given", async () => {
		expect(await update("UTC")).toBe("2026-11-03");
	});
});
