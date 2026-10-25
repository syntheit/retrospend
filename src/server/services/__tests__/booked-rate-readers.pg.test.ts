/**
 * The spending readers on a ledger whose rate moves (IMPLEMENTATION 2A.2,
 * step 5): which numbers follow the rate of the day they are read, and which
 * keep the value an entry got when it was saved.
 *
 * The home currency is ZZB, a stand-in for ARS: the pg files share one
 * database, and moving ARS rates here would move the other files' numbers.
 * Blue (the only type) is ZZB 1,000 per USD from Mar 1, 1,100 from Mar 20,
 * 1,200 from Apr 1 and 1,300 from Apr 8. "Now" is Apr 10 12:00 UTC, so March
 * is closed (its period rate is the Mar 31 one, 1,100) and April is running
 * (its period rate is today's, 1,300).
 *
 * Entries, all Groceries:
 *   A  Mar 10  USD 10     saved through the expense service (blue 1,000 that day)
 *   B  Apr  5  USD 20     saved through the expense service (blue 1,200 that day)
 *   C  Apr  2  ZZB 1,000  saved through the expense service
 *   D  Apr  6  USD 5      written straight to the table, no saved home value
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

import { ExpenseService } from "~/server/services/expense.service";
import { spentIn } from "~/server/services/figures/spent";
import { StatsService } from "~/server/services/stats.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { callers } from "./spending-readers";

const HOME = "ZZB";
const NOW = new Date("2026-04-10T12:00:00.000Z");
const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const APRIL_RANGE = {
	gte: new Date("2026-04-01T00:00:00.000Z"),
	lte: new Date("2026-04-30T23:59:59.999Z"),
};
// 31 days from A (Mar 10 12:00) to now, in the runway's 30.436875-day months.
const MONTHS_ACTIVE = 31 / 30.436875;

async function seed() {
	await adminDb.exchangeRate.createMany({
		data: [
			["2026-03-01", 1000],
			["2026-03-20", 1100],
			["2026-04-01", 1200],
			["2026-04-08", 1300],
		].map(([day, rate]) => ({
			date: new Date(`${day}T00:00:00.000Z`),
			currency: HOME,
			type: "blue",
			rate: rate as number,
		})),
		skipDuplicates: true,
	});
	const { user, db } = await createTestUser();
	const userId = user.id;
	await adminDb.user.update({
		where: { id: userId },
		data: { homeCurrency: HOME },
	});
	const groceries = await adminDb.category.create({
		data: { name: "Groceries", color: "emerald", userId },
	});

	const service = new ExpenseService(db as never);
	const save = (title: string, amount: number, currency: string, day: string) =>
		service.createExpense(userId, {
			id: crypto.randomUUID(),
			title,
			amount,
			currency,
			date: at(day),
			categoryId: groceries.id,
		});
	await save("A", 10, "USD", "2026-03-10");
	await save("B", 20, "USD", "2026-04-05");
	await save("C", 1000, HOME, "2026-04-02");
	await adminDb.expense.create({
		data: {
			userId,
			title: "D",
			amount: new Prisma.Decimal(5),
			currency: "USD",
			date: at("2026-04-06"),
			categoryId: groceries.id,
			amountInUSD: new Prisma.Decimal(5),
			exchangeRate: new Prisma.Decimal(1),
			pricingSource: "MANUAL",
		},
	});
	return { userId, db };
}

async function read({ userId, db }: Awaited<ReturnType<typeof seed>>) {
	const stats = new StatsService(db as never);
	const c = callers(userId);
	const runway = await c.wealth.getRunwayStats({ currency: HOME });
	return {
		lifetime: (await stats.getLifetimeStats(userId, HOME)).totalSpent,
		profileLifetime: (await c.profile.getLifetimeStats()).lifetimeSpend,
		runwayTimesMonths: runway.averageMonthlySpend * MONTHS_ACTIVE,
		spentApril: await spentIn(db, { userId, date: APRIL_RANGE }, HOME, 1300),
		// The lists send the booked value; the client shows it as is.
		listedHome: Object.fromEntries(
			(await c.expense.listFinalized()).map((e) => [e.title, e.home]),
		),
	};
}

/**
 * An entry saved through the expense service books its home value on its
 * own date, and every reader below counts that value in ZZB. Only D, which
 * has no booked value, follows the period rate:
 *   April   B 20 x 1,200 + C 1,000 + D 5 x 1,300     = 31,500
 *   life    A 10 x 1,000 + 31,500                    = 41,500
 */
const EXPECTED = {
	lifetime: 41_500,
	profileLifetime: 41_500,
	runwayTimesMonths: 41_500,
	spentApril: 31_500,
	// A 10,000.00, B 24,000.00, C 1,000.00 in minor units; D has none.
	listedHome: {
		A: { minor: 1_000_000, currency: HOME },
		B: { minor: 2_400_000, currency: HOME },
		C: { minor: 100_000, currency: HOME },
		D: null,
	},
};

describe("spending readers when the rate moves", () => {
	let readings: Awaited<ReturnType<typeof read>>;

	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		readings = await read(await seed());
	}, 120_000);
	afterAll(() => vi.useRealTimers());

	for (const [reader, expected] of Object.entries(EXPECTED)) {
		it(`pins ${reader}`, () => {
			const value = readings[reader as keyof typeof readings];
			if (typeof expected === "number") {
				expect(value).toBeCloseTo(expected, 6);
			} else {
				expect(value).toEqual(expected);
			}
		});
	}
});
