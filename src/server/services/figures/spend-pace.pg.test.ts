/**
 * Conformance of the two spend pace loaders on one ledger: the SQL loader
 * (loadSpendPaceInputs: grouped SUMs per entry instant, the share lookup, the
 * rate table) and the device loader (spendPaceInputsFromRows over the same
 * rows read raw) hand the domain compute the same inputs, so the glance
 * figures match digit for digit. Also the figures themselves, by hand.
 *
 * "Now" is 2026-10-15 15:00 UTC, noon in Buenos Aires: this period October
 * (31 days, day 15), the last September (30 days). Home ARS on the blue
 * rate: blue 1,400 from Sep 15 and 1,500 from Oct 5 (official 1,000 on Oct 5
 * never wins). The pg harness empties exchange_rate before each file, so the
 * rates are seeded here. Every row is at noon Buenos Aires (15:00Z) unless
 * said.
 *
 * Ana, October (ARS), by day:
 *   1   ARS 1,000.50
 *   3   USD 10 at blue 1,500 = 15,000, less a refund of ARS 200
 *   8   USD 100 booked at ARS 140,000 (it never moves with the rate), and
 *       ARS 25.25 + 10.10 at one instant (one SQL group), ARS 5 at that
 *       instant under a category (its own group)
 *   9   JPY 1,234 worth USD 8.23 = 12,345 and KWD 12.345 worth USD 40.1 =
 *       60,150
 *   12  her shares: ARS 3,000 and USD 20 = 30,000
 *   20  ARS 5,000 (later this period: in the total, not in the series)
 *   31  ARS 700 at 01:30Z on Nov 1 (Oct 31 in Buenos Aires, Nov 1 in UTC)
 * Running: d1 1,000.50; d3 15,800.50; d8 155,840.85; d9 228,335.85; d12
 * 261,335.85; day 15 is ARS 261,335.85 (26,133,585 minor). Whole period ARS
 * 267,035.85; UTC drops the Nov 1 row and gains the Sep 30 22:00 one: ARS
 * 266,635.85.
 * September: ARS 2,000 on the 10th; USD 4 on the 20th at blue 1,400 = 5,600;
 * refund ARS 100 on the 25th; ARS 300 at 01:00Z on Oct 1 (Sep 30 in Buenos
 * Aires). Total ARS 7,800 (UTC: 7,500). By day 15: ARS 2,000.
 * Money in: ARS 50,000 + USD 100 at 1,500 = ARS 200,000.
 */
import { randomUUID } from "node:crypto";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	lastToDate,
	type SpendPace,
	type SpendPaceInputs,
	homeRateOn,
	spendPaceFrom,
	spendPaceInputsFromRows,
} from "@retrospend/domain/spend-pace";
import type {
	SpentExpenseRow,
	SpentGroup,
	SpentShareRow,
} from "@retrospend/domain/spent";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { findExchangeRate } from "~/server/exchange-rates";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { loadSpendPace, loadSpendPaceInputs } from "./spend-pace";

const NOW = new Date("2026-10-15T15:00:00Z");
const BA = "America/Argentina/Buenos_Aires";
const SCL = "America/Santiago";
const D = (v: string | number) => new Prisma.Decimal(v);
const noon = (day: string) => new Date(`${day}T15:00:00Z`);

type Exp = {
	amount: string;
	date: Date;
	currency?: string;
	usd: string;
	direction?: "OUT" | "IN";
	inType?: "INCOME" | "REFUND";
	status?: "DRAFT" | "FINALIZED";
	entryKind?: "STANDARD" | "NOT_SPENDING";
	hidden?: boolean;
	categoryId?: string;
	booked?: { currency: string; amount: string };
};

async function addExpense(userId: string, e: Exp) {
	await fixtureDb.expense.create({
		data: {
			id: randomUUID(),
			userId,
			title: "row",
			amount: D(e.amount),
			currency: e.currency ?? "ARS",
			date: e.date,
			categoryId: e.categoryId ?? null,
			amountInUSD: D(e.usd),
			exchangeRate: D(1500),
			pricingSource: "MANUAL",
			status: e.status ?? "FINALIZED",
			direction: e.direction ?? "OUT",
			entryKind: e.entryKind ?? "STANDARD",
			inType: e.inType ?? null,
			excludeFromAnalytics: e.hidden ?? false,
			...(e.booked
				? {
						rateType: "blue",
						homeCurrency: e.booked.currency,
						homeAmount: D(e.booked.amount),
						homeRate: D(1400),
					}
				: {}),
		},
	});
}

async function addShare(
	userId: string,
	payer: string,
	s: {
		amount: string;
		currency?: string;
		rate?: string;
		date: Date;
		status?: "PENDING" | "REJECTED";
	},
) {
	await adminDb.sharedTransaction.create({
		data: {
			id: randomUUID(),
			description: "dinner",
			amount: D(s.amount),
			currency: s.currency ?? "ARS",
			date: s.date,
			exchangeRate: s.rate ? D(s.rate) : null,
			paidByType: "user",
			paidById: payer,
			createdByType: "user",
			createdById: payer,
			splitParticipants: {
				create: {
					participantType: "user",
					participantId: userId,
					shareAmount: D(s.amount),
					verificationStatus: s.status ?? "PENDING",
				},
			},
		},
	});
}

/** The device loader's input: every row of the person, read raw, with nothing filtered. */
async function rawRows(userId: string) {
	const expenses = (
		await fixtureDb.expense.findMany({
			where: { userId },
			include: { category: { select: { kind: true } } },
		})
	).map(
		(r): SpentExpenseRow => ({
			status: r.status,
			direction: r.direction,
			entryKind: r.entryKind,
			inType: r.inType,
			isAmortizedParent: r.isAmortizedParent,
			excludeFromAnalytics: r.excludeFromAnalytics,
			categoryKind: r.category?.kind ?? null,
			categoryId: r.categoryId,
			date: r.date,
			currency: r.currency,
			amount: r.amount.toFixed(),
			amountInUSD: r.amountInUSD.toFixed(),
			homeCurrency: r.homeCurrency,
			homeAmount: r.homeAmount?.toFixed() ?? null,
		}),
	);
	const shares = (
		await adminDb.splitParticipant.findMany({
			where: { participantType: "user", participantId: userId },
			include: { transaction: true },
		})
	).map(
		(p): SpentShareRow => ({
			shareAmount: p.shareAmount.toFixed(),
			verificationStatus: p.verificationStatus,
			currency: p.transaction.currency,
			date: p.transaction.date,
			projectId: p.transaction.projectId,
			exchangeRate: p.transaction.exchangeRate?.toFixed() ?? null,
			categoryId: null,
		}),
	);
	return { expenses, shares, hiddenProjectIds: [] as string[] };
}

type Person = { id: string; home: string; startDay: number };

async function homeRates(home: string) {
	return (
		await adminDb.exchangeRate.findMany({ where: { currency: home } })
	).map((r) => ({ date: r.date, rate: Number(r.rate), type: r.type }));
}

const exact = (g: SpentGroup) => ({
	...g,
	date: g.date?.toISOString() ?? null,
	amount: dec(g.amount).toFixed(),
	amountInUSD: dec(g.amountInUSD).toFixed(),
	homeAmount: dec(g.homeAmount).toFixed(),
});
const groups = (l: SpentGroup[]) =>
	l
		.map(exact)
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const shares = (l: SpendPaceInputs["spending"]["shares"]) =>
	l
		.map((s) => ({ ...s, date: s.date.toISOString() }))
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

const sql = (p: Person, now: Date, zone: string) =>
	userTransaction(adminDb, p.id, (tx) =>
		loadSpendPaceInputs(tx, p.id, now, p.home, p.startDay, zone),
	);
const device = async (p: Person, now: Date, zone: string) =>
	spendPaceInputsFromRows({
		...(await rawRows(p.id)),
		home: p.home,
		homeRates: await homeRates(p.home),
		now,
		startDay: p.startDay,
		timeZone: zone,
	});
const compute = (p: Person, now: Date, zone: string, inputs: SpendPaceInputs) =>
	spendPaceFrom({
		home: p.home,
		startDay: p.startDay,
		now,
		timeZone: zone,
		inputs,
	});

/** Both loaders read the same inputs and the compute gives the same pace; returns the served pace. */
async function bothAgree(p: Person, now: Date, zone: string) {
	const a = await sql(p, now, zone);
	const b = await device(p, now, zone);
	expect(groups(a.spending.spending)).toEqual(groups(b.spending.spending));
	expect(groups(a.spending.refunds)).toEqual(groups(b.spending.refunds));
	expect(shares(a.spending.shares)).toEqual(shares(b.spending.shares));
	expect(groups(a.income)).toEqual(groups(b.income));
	expect(a.thisRate).toBe(b.thisRate);
	expect(a.lastRate).toBe(b.lastRate);
	const served = await userTransaction(adminDb, p.id, (tx) =>
		loadSpendPace(tx, p.id, now, zone),
	);
	expect(served).toEqual(compute(p, now, zone, b));
	return served;
}

const rateDay = (day: string, currency: string, rate: string, type: string) =>
	adminDb.exchangeRate.create({
		data: { date: new Date(`${day}T00:00:00Z`), currency, type, rate },
	});

let ana: Person;
let santiago: Person;
let february: Person;
let rateless: Person;
let jpyHome: Person;
let kwdHome: Person;
let uyuHome: Person;

async function seedUser(
	home: string,
	zone: string,
	startDay = 1,
): Promise<Person> {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: home, timeZone: zone, fiscalMonthStartDay: startDay },
	});
	return { id: user.id, home, startDay };
}

beforeAll(async () => {
	await rateDay("2026-09-15", "ARS", "1400", "blue");
	await rateDay("2026-10-05", "ARS", "1500", "blue");
	await rateDay("2026-10-05", "ARS", "1000", "official");
	await rateDay("2026-10-01", "JPY", "150", "official");
	await rateDay("2026-10-01", "KWD", "0.3", "official");

	ana = await seedUser("ARS", BA);
	const { user: bob } = await createTestUser();
	const groceries = await fixtureDb.category.create({
		data: { name: "Groceries", color: "emerald", userId: ana.id },
	});
	const salary = await fixtureDb.category.create({
		data: { name: "Salary", color: "blue", userId: ana.id, kind: "INCOME" },
	});
	const own = (e: Exp) => addExpense(ana.id, e);
	await own({ amount: "1000.50", usd: "0.67", date: noon("2026-10-01") });
	await own({
		amount: "10",
		currency: "USD",
		usd: "10",
		date: noon("2026-10-03"),
	});
	await own({
		amount: "200",
		usd: "0.13",
		date: noon("2026-10-03"),
		direction: "IN",
		inType: "REFUND",
	});
	await own({
		amount: "100",
		currency: "USD",
		usd: "100",
		date: noon("2026-10-08"),
		booked: { currency: "ARS", amount: "140000" },
	});
	await own({ amount: "25.25", usd: "0.02", date: noon("2026-10-08") });
	await own({ amount: "10.10", usd: "0.01", date: noon("2026-10-08") });
	await own({
		amount: "5",
		usd: "0",
		date: noon("2026-10-08"),
		categoryId: groceries.id,
	});
	await own({
		amount: "1234",
		currency: "JPY",
		usd: "8.23",
		date: noon("2026-10-09"),
	});
	await own({
		amount: "12.345",
		currency: "KWD",
		usd: "40.1",
		date: noon("2026-10-09"),
	});
	await own({ amount: "5000", usd: "3.33", date: noon("2026-10-20") });
	await own({
		amount: "700",
		usd: "0.47",
		date: new Date("2026-11-01T01:30:00Z"),
	});
	await own({ amount: "2000", usd: "1.43", date: noon("2026-09-10") });
	await own({
		amount: "4",
		currency: "USD",
		usd: "4",
		date: noon("2026-09-20"),
	});
	await own({
		amount: "100",
		usd: "0.07",
		date: noon("2026-09-25"),
		direction: "IN",
		inType: "REFUND",
	});
	await own({
		amount: "300",
		usd: "0.21",
		date: new Date("2026-10-01T01:00:00Z"),
	});
	await own({ amount: "9999", usd: "7", date: noon("2026-08-31") });
	// Money in, and rows that are not spending or income.
	await own({
		amount: "50000",
		usd: "33.33",
		date: noon("2026-10-05"),
		direction: "IN",
		inType: "INCOME",
		categoryId: salary.id,
	});
	await own({
		amount: "100",
		currency: "USD",
		usd: "100",
		date: noon("2026-10-06"),
		direction: "IN",
		inType: "INCOME",
	});
	await own({
		amount: "77",
		usd: "0.05",
		date: noon("2026-10-06"),
		direction: "IN",
		inType: "INCOME",
		hidden: true,
	});
	await own({
		amount: "66",
		usd: "0.04",
		date: noon("2026-10-06"),
		direction: "IN",
		inType: "INCOME",
		status: "DRAFT",
	});
	await own({
		amount: "900",
		usd: "1",
		date: noon("2026-10-05"),
		status: "DRAFT",
	});
	await own({
		amount: "900",
		usd: "1",
		date: noon("2026-10-05"),
		hidden: true,
	});
	await own({
		amount: "900",
		usd: "1",
		date: noon("2026-10-05"),
		entryKind: "NOT_SPENDING",
	});
	await addShare(ana.id, bob.id, {
		amount: "3000",
		rate: "1500",
		date: noon("2026-10-12"),
	});
	await addShare(ana.id, bob.id, {
		amount: "20",
		currency: "USD",
		date: noon("2026-10-12"),
	});
	await addShare(ana.id, bob.id, {
		amount: "7",
		rate: "1500",
		date: noon("2026-10-12"),
		status: "REJECTED",
	});

	// Summer time in Santiago starts at 24:00 on Saturday Sep 5 2026.
	santiago = await seedUser("ARS", SCL);
	await addExpense(santiago.id, {
		amount: "100",
		usd: "0.07",
		date: new Date("2026-09-06T03:59:59Z"),
	});
	await addExpense(santiago.id, {
		amount: "200",
		usd: "0.14",
		date: new Date("2026-09-06T04:00:00Z"),
	});

	february = await seedUser("ARS", BA);
	for (const [day, amount] of [
		["2027-01-28", "10"],
		["2027-01-31", "5"],
		["2027-02-28", "40"],
	] as const)
		await addExpense(february.id, { amount, usd: "0.01", date: noon(day) });

	// USD 5 this period, USD 20 of income, and no ISK rate anywhere.
	rateless = await seedUser("ISK", BA);
	await addExpense(rateless.id, {
		amount: "10",
		usd: "0.07",
		currency: "ISK",
		date: noon("2026-09-02"),
	});
	await addExpense(rateless.id, {
		amount: "5",
		currency: "USD",
		usd: "5",
		date: noon("2026-10-02"),
	});
	await addExpense(rateless.id, {
		amount: "20",
		currency: "USD",
		usd: "20",
		date: noon("2026-10-03"),
		direction: "IN",
		inType: "INCOME",
	});

	jpyHome = await seedUser("JPY", BA);
	await addExpense(jpyHome.id, {
		amount: "10",
		currency: "USD",
		usd: "10",
		date: noon("2026-10-02"),
	});
	await addExpense(jpyHome.id, {
		amount: "1234",
		currency: "JPY",
		usd: "8.23",
		date: noon("2026-10-02"),
	});
	await addExpense(jpyHome.id, {
		amount: "12.345",
		currency: "KWD",
		usd: "40",
		date: noon("2026-10-02"),
	});
	// UYU: one stale blue row (40) behind 25 daily official rows (30) from Sep
	// 20 to Oct 14. The server reads the newest 20 rows on or before a date,
	// so for now they are all official; for the end of September only 12
	// official rows exist and the blue row is in the window.
	for (let i = 0; i < 25; i++)
		await rateDay(
			new Date(Date.UTC(2026, 8, 20 + i)).toISOString().slice(0, 10),
			"UYU",
			"30",
			"official",
		);
	await rateDay("2026-09-01", "UYU", "40", "blue");
	uyuHome = await seedUser("UYU", BA);
	await addExpense(uyuHome.id, {
		amount: "10",
		currency: "USD",
		usd: "10",
		date: noon("2026-10-02"),
	});
	await addExpense(uyuHome.id, {
		amount: "10",
		currency: "USD",
		usd: "10",
		date: noon("2026-09-02"),
	});
	kwdHome = await seedUser("KWD", BA);
	await addExpense(kwdHome.id, {
		amount: "100",
		currency: "USD",
		usd: "100",
		date: noon("2026-10-02"),
	});
	await addExpense(kwdHome.id, {
		amount: "1500",
		currency: "JPY",
		usd: "10",
		date: noon("2026-10-02"),
	});
	await addExpense(kwdHome.id, {
		amount: "1.2345",
		currency: "KWD",
		usd: "4",
		date: noon("2026-10-02"),
	});
});

describe.each([BA, "UTC"])("spend pace loaders in %s", (zone) => {
	it("the SQL loader and the device loader read the same inputs, digit for digit", async () => {
		const served = await bothAgree(ana, NOW, zone);
		expect(served.missingRates).toEqual([]);
	});
});

describe("Ana's glance by hand", () => {
	it("Buenos Aires: day 15 is ARS 261,335.85, the whole period 267,035.85", async () => {
		const p = await bothAgree(ana, NOW, BA);
		expect(p.period).toMatchObject({ from: "2026-10-01", days: 31, day: 15 });
		expect(p.thisSeries).toHaveLength(15);
		expect(p.thisSeries?.[0]).toBe(100_050);
		expect(p.thisSeries?.[2]).toBe(1_580_050);
		expect(p.thisSeries?.[7]).toBe(15_584_085);
		expect(p.thisSeries?.[8]).toBe(22_833_585);
		expect(p.thisSeries?.[11]).toBe(26_133_585);
		expect(p.thisSeries?.[14]).toBe(26_133_585);
		expect(p.thisTotal).toBe(26_703_585);
		expect(p.lastTotal).toBe(780_000);
		expect(p.lastSeries?.[14]).toBe(200_000);
		expect(lastToDate(p)).toBe(200_000);
		expect(p.moneyIn).toBe(20_000_000);
	});

	it("UTC moves the Nov 1 row out and the Sep 30 22:00 row in", async () => {
		const p = await bothAgree(ana, NOW, "UTC");
		expect(p.thisSeries?.[0]).toBe(130_050);
		expect(p.thisTotal).toBe(26_663_585);
		expect(p.lastTotal).toBe(750_000);
	});

	it("the figures read the same numbers through the registry path", async () => {
		const p = await userTransaction(adminDb, ana.id, (tx) =>
			loadSpendPace(tx, ana.id, NOW, BA),
		);
		expect(p.home).toBe("ARS");
		expect(p.today).toBe("2026-10-15");
		expect(p.missingRates).toEqual([]);
	});
});

describe("edges, server and device together", () => {
	it("Santiago summer time: Sep 5 23:59:59 and Sep 6 01:00 are different days", async () => {
		const now = new Date("2026-09-06T15:00:00Z");
		const p: SpendPace = await bothAgree(santiago, now, SCL);
		expect(p.period).toMatchObject({ from: "2026-09-01", days: 30, day: 6 });
		expect(p.thisSeries).toEqual([0, 0, 0, 0, 10_000, 30_000]);
	});

	it("February 2027: day 28 of 28 against January's 31, compared on its day 28", async () => {
		const now = new Date("2027-02-28T15:00:00Z");
		const p = await bothAgree(february, now, BA);
		expect(p.period).toMatchObject({ days: 28, day: 28 });
		expect(p.last.days).toBe(31);
		expect(p.thisTotal).toBe(4_000);
		expect(p.lastTotal).toBe(1_500);
		expect(lastToDate(p)).toBe(1_000);
	});

	it("the first second of October in Buenos Aires is day 1, one second earlier is Sep 30", async () => {
		const first = await bothAgree(ana, new Date("2026-10-01T03:00:00Z"), BA);
		expect(first.period.day).toBe(1);
		expect(first.thisSeries).toHaveLength(1);
		const before = await bothAgree(ana, new Date("2026-10-01T02:59:59Z"), BA);
		expect(before.today).toBe("2026-09-30");
		expect(before.period).toMatchObject({ days: 30, day: 30 });
	});

	it("the last day of the period fills the whole series", async () => {
		const p = await bothAgree(ana, new Date("2026-11-01T02:59:00Z"), BA);
		expect(p.period).toMatchObject({ days: 31, day: 31 });
		expect(p.thisSeries).toHaveLength(31);
		expect(p.thisSeries?.at(-1)).toBe(p.thisTotal);
	});
});

describe("home currencies and missing rates", () => {
	it("JPY home at 150 per USD: 1,500 + 1,234 + 6,000 = JPY 8,734", async () => {
		const p = await bothAgree(jpyHome, NOW, BA);
		expect(p.thisTotal).toBe(8_734);
	});

	it("KWD home at 0.3 per USD: 30 + 3 + 1.2345 = 34.2345, half to even, KWD 34.234", async () => {
		const p = await bothAgree(kwdHome, NOW, BA);
		expect(p.thisTotal).toBe(34_234);
	});

	it("no rate for the home currency: unavailable and named on both loaders, never 1", async () => {
		const p = await bothAgree(rateless, NOW, BA);
		expect(p.thisSeries).toBeNull();
		expect(p.thisTotal).toBeNull();
		expect(p.moneyIn).toBeNull();
		expect(p.missingRates).toEqual(["ISK"]);
		// Last period has only ISK 10, in the home currency itself (no decimals).
		expect(p.lastTotal).toBe(10);
	});
});

describe("the rate window", () => {
	it("a blue row older than 20 official ones loses this period and wins the last, on both loaders", async () => {
		const p = await bothAgree(uyuHome, NOW, BA);
		// This period: USD 10 at official 30 = UYU 300. Last period (ends Oct 1
		// 02:59Z): 12 official rows, so blue 40 is in the window: UYU 400.
		expect(p.thisTotal).toBe(30_000);
		expect(p.lastTotal).toBe(40_000);
	});

	it("homeRateOn equals the server's lookup on dates before, inside and after the rows", async () => {
		const rows = await homeRates("UYU");
		for (const iso of [
			"2026-08-01T00:00:00Z",
			"2026-09-10T00:00:00Z",
			"2026-10-01T02:59:59Z",
			"2026-10-15T15:00:00Z",
			"2027-01-01T00:00:00Z",
		]) {
			const date = new Date(iso);
			const served = await userTransaction(adminDb, uyuHome.id, (tx) =>
				findExchangeRate(tx, "UYU", date),
			);
			expect(homeRateOn("UYU", rows, date), iso).toBe(served?.rate ?? null);
		}
	});
});
