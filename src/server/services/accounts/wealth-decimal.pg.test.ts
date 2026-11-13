/**
 * The Wealth dashboard's exact decimals on real Postgres, ARS home at blue
 * 1,545 per USD (PR 4b of docs/roadmap/money-decimal.md). Rates: ARS blue
 * 1,545, JPY official 150 per USD, BTC crypto 60,000 USD per coin.
 *
 * - Cash ARS 1,000,000; Wise USD 1,840.55 (x 1,545 = 2,843,649.75); Bitcoin
 *   0.01234567 (x 60,000 x 1,545 = 1,144,443.609); Yen 150,000 (/ 150 x
 *   1,545 = 1,545,000).
 * - Card USD 300 owed (463,500); Loan ARS 842,600 owed.
 * Assets 6,533,093.359 and liabilities 1,306,100 give net worth
 * 5,226,993.359, ARS 5,226,993.36 once rounded: 522,699,336 minor units,
 * the same number the registered netWorth figure reads.
 *
 * Forty days ago the Cash account held ARS 900,000 and Wise USD 1,000: net
 * worth then 900,000 + 1,000 x 1,545 = ARS 2,445,000, at that day's rates.
 * A second user holds USD 0.001, which is ARS 1.545 exactly: a tie, 1.54.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeDate } from "~/lib/date";
import { readFigures } from "~/server/figures/read";
import { WealthService } from "~/server/services/wealth.service";
import type { AssetType } from "~prisma";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const today = normalizeDate(new Date());
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

async function seedRates() {
	for (const [currency, type, rate] of [
		["ARS", "blue", "1545"],
		["JPY", "official", "150"],
		["BTC", "crypto", "60000"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: today, currency, type } },
			create: { date: today, currency, type, rate },
			update: { rate },
		});
	}
}

async function homeUser(): Promise<TestUser> {
	const u = await createTestUser();
	await adminDb.user.update({
		where: { id: u.user.id },
		data: { homeCurrency: "ARS" },
	});
	return u;
}

async function open(
	u: TestUser,
	a: {
		name: string;
		type: AssetType;
		currency: string;
		balance: string;
		rate: number;
		rateType: string | null;
		liquid?: boolean;
		interest?: string;
		before?: [Date, string];
	},
) {
	const created = await fixtureDb.assetAccount.create({
		data: {
			userId: u.user.id,
			name: a.name,
			type: a.type,
			currency: a.currency,
			balance: a.balance,
			exchangeRate: a.rate,
			exchangeRateType: a.rateType,
			isLiquid: a.liquid ?? false,
			interestRate: a.interest ?? null,
		},
	});
	const snapshots: [Date, string][] = [];
	if (a.before) snapshots.push(a.before);
	snapshots.push([today, a.balance]);
	for (const [date, balance] of snapshots) {
		await adminDb.assetSnapshot.create({
			data: {
				accountId: created.id,
				userId: u.user.id,
				date,
				balance,
				balanceInUSD: 0,
				currency: a.currency,
				type: a.type,
				exchangeRateType: a.rateType,
			},
		});
	}
}

let sofia: TestUser;
let tie: TestUser;

beforeAll(async () => {
	await seedRates();
	sofia = await homeUser();
	await open(sofia, {
		name: "Cash",
		type: "CASH",
		currency: "ARS",
		balance: "1000000",
		rate: 1545,
		rateType: "blue",
		liquid: true,
		before: [daysAgo(40), "900000"],
	});
	await open(sofia, {
		name: "Wise",
		type: "INVESTMENT",
		currency: "USD",
		balance: "1840.55",
		rate: 1,
		rateType: null,
		before: [daysAgo(40), "1000"],
	});
	await open(sofia, {
		name: "Bitcoin",
		type: "CRYPTO",
		currency: "BTC",
		balance: "0.01234567",
		rate: 60000,
		rateType: "crypto",
	});
	await open(sofia, {
		name: "Yen",
		type: "CASH",
		currency: "JPY",
		balance: "150000",
		rate: 150,
		rateType: "official",
		liquid: true,
	});
	await open(sofia, {
		name: "Card",
		type: "LIABILITY_CREDIT_CARD",
		currency: "USD",
		balance: "300",
		rate: 1,
		rateType: null,
		interest: "40",
	});
	await open(sofia, {
		name: "Loan",
		type: "LIABILITY_LOAN",
		currency: "ARS",
		balance: "842600",
		rate: 1545,
		rateType: "blue",
	});
	tie = await homeUser();
	await open(tie, {
		name: "Pocket",
		type: "CASH",
		currency: "USD",
		balance: "0.001",
		rate: 1,
		rateType: null,
	});
});

describe("Wealth dashboard in an ARS home with fiat, crypto and liabilities", () => {
	it("totals the accounts exactly and rounds the sum once", async () => {
		const s = await new WealthService(sofia.db).getDashboardSummary(
			sofia.user.id,
			"ARS",
		);
		expect(s.totalAssets).toBe(6_533_093.36);
		expect(s.totalLiabilities).toBe(1_306_100);
		expect(s.totalNetWorth).toBe(5_226_993.36);
		expect(s.totalLiquidAssets).toBe(2_545_000);
		// Weighted by USD owed: 40 x 300 / (300 + 842,600 / 1,545) =
		// 12,000 / 845.372168 = 14.19493 (the loan adds to the owed total and carries no interest).
		expect(s.weightedAPR).toBeCloseTo(14.19493, 4);
		expect(s.missingRateCurrencies).toEqual([]);
	});

	it("the netWorth figure reads the same minor units", async () => {
		const readings = await readFigures(sofia.user.id, ["netWorth"]);
		expect(readings.get("netWorth")).toEqual([
			{ minor: 522_699_336, currency: "ARS" },
		]);
	});

	it("history values a past day with that rule at that day's rates", async () => {
		const s = await new WealthService(sofia.db).getDashboardSummary(
			sofia.user.id,
			"ARS",
		);
		const then = s.history.find(
			(h) => h.date === daysAgo(40).toISOString().slice(0, 10),
		);
		expect(then).toEqual({
			date: daysAgo(40).toISOString().slice(0, 10),
			amount: 2_445_000,
			assets: 2_445_000,
			liabilities: 0,
		});
		expect(s.history.at(-1)?.amount).toBe(s.totalNetWorth);
	});
});

describe("Wealth dashboard on an exact tie", () => {
	it("USD 0.001 is ARS 1.545: half to even, 1.54, in the figure too", async () => {
		const s = await new WealthService(tie.db).getDashboardSummary(
			tie.user.id,
			"ARS",
		);
		expect(s.totalNetWorth).toBe(1.54);
		const readings = await readFigures(tie.user.id, ["netWorth"]);
		expect(readings.get("netWorth")).toEqual([{ minor: 154, currency: "ARS" }]);
	});
});

describe("Wealth dashboard in other homes", () => {
	it("a JPY home rounds to whole yen and a USD home to cents", async () => {
		const service = new WealthService(sofia.db);
		const yen = await service.getDashboardSummary(sofia.user.id, "JPY");
		const usd = await service.getDashboardSummary(sofia.user.id, "USD");
		// Net worth is ARS 5,226,993.359 exactly. In JPY (x 150 / 1,545):
		// 52,269,933.59 / 103 = 507,475.08, so 507,475. In USD (/ 1,545):
		// 1,545 x 3,383 = 5,226,735, and 258.359 / 1,545 = 0.1672, so 3,383.17.
		expect(yen.totalNetWorth).toBe(507_475);
		expect(usd.totalNetWorth).toBe(3_383.17);
	});
});
