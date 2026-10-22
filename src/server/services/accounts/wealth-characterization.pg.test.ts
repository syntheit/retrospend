/**
 * Characterization of today's Wealth numbers for a user with no account
 * legs (2D.1): written before legs existed, so the leg-aware history and the
 * new figures must leave these exact numbers alone.
 *
 * Fixture (ARS home): rates today ARS 1,468 Blue and 1,412 Official per USD.
 * - Digital wallet, ARS cash at Blue: ARS 900,000 forty days ago, ARS
 *   1,000,000 today.
 * - Wise, USD 1,840.55 (no rate type): valued through ARS Blue, the
 *   default pick, 1,840.55 x 1,468 = ARS 2,701,927.40.
 * - Credit card, ARS 842,600 owed.
 * Net worth = 1,000,000 + 2,701,927.40 - 842,600 = ARS 2,859,327.40.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeDate } from "~/lib/date";
import { readFigures } from "~/server/figures/read";
import { WealthService } from "~/server/services/wealth.service";
import { adminDb, createTestUser } from "~/test/pg-harness";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const today = normalizeDate(new Date());
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

async function seedRates() {
	for (const [type, rate] of [
		["blue", "1468"],
		["official", "1412"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: {
				date_currency_type: { date: today, currency: "ARS", type },
			},
			create: { date: today, currency: "ARS", type, rate },
			update: { rate },
		});
	}
}

async function account(
	u: TestUser,
	data: {
		name: string;
		type: "CASH" | "INVESTMENT" | "LIABILITY_CREDIT_CARD";
		currency: string;
		rateType: string | null;
		snapshots: [Date, string][];
	},
) {
	const last = data.snapshots[data.snapshots.length - 1]?.[1] ?? "0";
	const created = await adminDb.assetAccount.create({
		data: {
			userId: u.user.id,
			name: data.name,
			type: data.type,
			currency: data.currency,
			balance: last,
			exchangeRate: data.currency === "USD" ? 1 : 1468,
			exchangeRateType: data.rateType,
			isLiquid: data.type === "CASH",
		},
	});
	for (const [date, balance] of data.snapshots) {
		await adminDb.assetSnapshot.create({
			data: {
				accountId: created.id,
				userId: u.user.id,
				date,
				balance,
				balanceInUSD: 0,
				currency: data.currency,
				type: data.type,
				exchangeRateType: data.rateType,
			},
		});
	}
	return created;
}

let sofia: TestUser;

beforeAll(async () => {
	await seedRates();
	sofia = await createTestUser();
	await adminDb.user.update({
		where: { id: sofia.user.id },
		data: { homeCurrency: "ARS" },
	});
	await account(sofia, {
		name: "Digital wallet",
		type: "CASH",
		currency: "ARS",
		rateType: "blue",
		snapshots: [
			[daysAgo(40), "900000"],
			[today, "1000000"],
		],
	});
	await account(sofia, {
		name: "Wise",
		type: "INVESTMENT",
		currency: "USD",
		rateType: null,
		snapshots: [[today, "1840.55"]],
	});
	await account(sofia, {
		name: "Credit card",
		type: "LIABILITY_CREDIT_CARD",
		currency: "ARS",
		rateType: "blue",
		snapshots: [[today, "842600"]],
	});
});

describe("Wealth dashboard for a user without legs (characterization)", () => {
	it("keeps the headline totals", async () => {
		const summary = await new WealthService(sofia.db).getDashboardSummary(
			sofia.user.id,
			"ARS",
		);
		expect(summary.totalNetWorth).toBeCloseTo(2_859_327.4, 2);
		expect(summary.totalAssets).toBeCloseTo(3_701_927.4, 2);
		expect(summary.totalLiabilities).toBeCloseTo(842_600, 2);
		expect(summary.totalLiquidAssets).toBeCloseTo(1_000_000, 2);
		expect(summary.missingRateCurrencies).toEqual([]);
	});

	it("keeps the history points and the 30-day baseline", async () => {
		const summary = await new WealthService(sofia.db).getDashboardSummary(
			sofia.user.id,
			"ARS",
		);
		const points = summary.history.map((h) => [h.date, Math.round(h.amount)]);
		expect(points).toEqual([
			[daysAgo(40).toISOString().slice(0, 10), 900_000],
			[today.toISOString().slice(0, 10), 2_859_327],
		]);
		expect(summary.netWorth30DaysAgo).toBeCloseTo(900_000, 2);
	});

	it("the netWorth figure is today's Wealth total, to the minor unit", async () => {
		const readings = await readFigures(sofia.user.id, [
			"netWorth",
			"netWorthChange.total",
			"notTracked",
		]);
		expect(readings.get("netWorth")).toEqual([
			{ minor: 285_932_740, currency: "ARS" },
		]);
		expect(readings.get("notTracked")).toEqual([]);
		// Over the last 30 days: the wallet went from 900,000 to everything today.
		expect(readings.get("netWorthChange.total")).toEqual([
			{ minor: 285_932_740 - 90_000_000, currency: "ARS" },
		]);
	});
});
