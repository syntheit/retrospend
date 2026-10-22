/**
 * The spending readers on a ledger whose rate moves (IMPLEMENTATION 2A.2,
 * step 5): which numbers follow the rate of the day they are read, and which
 * keep the value an entry got when it was saved.
 *
 * Home ARS. Blue (the only type) is ARS 1,000 per USD from Mar 1, 1,100 from
 * Mar 20, 1,200 from Apr 1 and 1,300 from Apr 8. "Now" is Apr 10 12:00 UTC,
 * so March is closed (its period rate is the Mar 31 one, 1,100) and April is
 * running (its period rate is today's, 1,300).
 *
 * Entries, all Groceries:
 *   A  Mar 10  USD 10     saved through the expense service (blue 1,000 that day)
 *   B  Apr  5  USD 20     saved through the expense service (blue 1,200 that day)
 *   C  Apr  2  ARS 1,000  saved through the expense service
 *   D  Apr  6  USD 5      written straight to the table, no saved home value
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

import { getBudgets } from "~/server/services/budget.service";
import { ExpenseService } from "~/server/services/expense.service";
import { spentIn } from "~/server/services/figures/spent";
import {
	getOverviewSettings,
	getOverviewStats,
} from "~/server/services/overview.service";
import { RateCache } from "~/server/services/rate-cache";
import { StatsService } from "~/server/services/stats.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { callers } from "./spending-readers";

const NOW = new Date("2026-04-10T12:00:00.000Z");
const MARCH = new Date("2026-03-15T12:00:00.000Z");
const APRIL = new Date("2026-04-10T12:00:00.000Z");
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
			currency: "ARS",
			type: "blue",
			rate: rate as number,
		})),
		skipDuplicates: true,
	});
	const { user, db } = await createTestUser();
	const userId = user.id;
	await adminDb.user.update({
		where: { id: userId },
		data: { homeCurrency: "ARS" },
	});
	const groceries = await adminDb.category.create({
		data: { name: "Groceries", color: "emerald", userId },
	});
	await adminDb.budget.create({
		data: {
			userId,
			categoryId: groceries.id,
			amount: 100_000,
			currency: "ARS",
			period: new Date(2026, 3, 1),
		},
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
	await save("C", 1000, "ARS", "2026-04-02");
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
	const stats = new StatsService(db as never, undefined, [], "UTC");
	const c = callers(userId);
	const [april] = await getBudgets(db as never, userId, APRIL, {
		includeGlobal: true,
		excludedProjectIds: [],
		homeCurrency: "ARS",
		timeZone: "UTC",
	});
	const overview = await getOverviewStats(db as never, userId, {
		...(await getOverviewSettings(db as never, userId)),
		month: APRIL,
		homeCurrency: "ARS",
		excludedProjectIds: [],
		rateCache: new RateCache(db as never),
		timeZone: "UTC",
	});
	const runway = await c.wealth.getRunwayStats({ currency: "ARS" });
	return {
		marchTotal: (await stats.getSummaryStats(userId, MARCH, "ARS"))
			.totalThisMonth,
		aprilTotal: (await stats.getSummaryStats(userId, APRIL, "ARS"))
			.totalThisMonth,
		aprilInUsd: (await stats.getSummaryStats(userId, APRIL, "USD"))
			.totalThisMonth,
		aprilByCategory: (
			await stats.getCategoryBreakdown(userId, APRIL, "ARS")
		).map((x) => [x.name, x.value]),
		aprilTrendEnd: (await stats.getDailyTrend(userId, APRIL, "ARS")).at(-1)
			?.total,
		lifetime: (await stats.getLifetimeStats(userId, "ARS")).totalSpent,
		profileLifetime: (await c.profile.getLifetimeStats()).lifetimeSpend,
		dashboardMonth: overview.monthTotal,
		budgetSpent: [april?.actualSpend, april?.actualSpendInHome],
		runwayTimesMonths: runway.averageMonthlySpend * MONTHS_ACTIVE,
		spentApril: await spentIn(db, { userId, date: APRIL_RANGE }, "ARS", 1300),
	};
}

/**
 * Today every reader converts each foreign entry at its period's rate, so
 * April (running) moves with today's 1,300 and lifetime converts everything
 * at today's rate:
 *   March   A 10 x 1,100                             = 11,000
 *   April   B 20 x 1,300 + C 1,000 + D 5 x 1,300     = 33,500
 *   in USD  B 20 + C 1,000 / 1,200 (0.83) + D 5      = 25.83
 *   life    A 13,000 + 33,500                        = 46,500
 */
const EXPECTED = {
	marchTotal: 11_000,
	aprilTotal: 33_500,
	aprilInUsd: 25.83,
	aprilByCategory: [["Groceries", 33_500]],
	aprilTrendEnd: 33_500,
	lifetime: 46_500,
	profileLifetime: 46_500,
	dashboardMonth: 33_500,
	budgetSpent: [33_500, 33_500],
	runwayTimesMonths: 46_500,
	spentApril: 33_500,
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
