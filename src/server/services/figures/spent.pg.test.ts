/**
 * Conformance of the two `spent` loaders on one ledger: the SQL loader
 * (loadSpentInputs, grouped SUMs over numeric and the share lookup) and the
 * device loader (spentInputsFromRows over the same rows read raw) must hand
 * the domain compute identical inputs, so the figure and the home-currency
 * totals match digit for digit. A device runs the second one.
 *
 * Home currency ARS, blue 1,500 per USD. "Now" is 2026-10-15 12:00 UTC. The
 * ledger has a row at 01:30Z on Oct 1 (Sept 30 in Buenos Aires) and one at
 * 01:30Z on Nov 1 (Oct 31 there), so the zone moves them across the month.
 * Currencies: ARS, USD, JPY (no decimals), KWD (3), XQZ (no rate at all).
 *
 * Counted, Buenos Aires October (Oct 1 03:00Z to Nov 1 02:59:59.999Z):
 *   ARS  250.25 + 10,000 - 1,500 refund + shares 75,000 + 20  = 83,770.25
 *   USD  100 (booked ARS 150,000) + share 12.50               = 112.50
 *   JPY  1,234 + 766                                          = 2,000
 *   KWD  (12.345 + 1.2345 legacy, half to even) 13.580 + 1.236 = 14.816
 * UTC October swaps the 250.25 row for the 1,000.50 one and drops the Nov 1
 * share: ARS 84,500.50.
 * Home total in ARS at 1,500, Buenos Aires: own ARS 8,750.25 + 75,020, booked
 * 150,000 and 3,706.50, USD 12.50 -> 18,750, JPY USD 13 -> 19,500, KWD USD 44
 * -> 66,000 = 341,726.75.
 */
import { randomUUID } from "node:crypto";
import { MissingRateError, sumIn } from "@retrospend/domain/money";
import {
	type SpentExpenseRow,
	type SpentGroup,
	type SpentInputs,
	type SpentShareRow,
	spentInputsFromRows,
	spentItemsOf,
	spentMinorByCurrency,
	spentRange,
} from "@retrospend/domain/spent";
import { dec } from "@retrospend/domain/precise-decimal";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { ensureIncomeCategories } from "~/server/services/money-in.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { loadSpentInputs, spentAt, spentIn } from "./spent";

const NOW = new Date("2026-10-15T12:00:00Z");
const BA = "America/Argentina/Buenos_Aires";
const MID = new Date("2026-10-10T12:00:00Z");
const D = (v: string | number) => new Prisma.Decimal(v);

type Exp = {
	amount: string;
	currency?: string;
	amountInUSD: string;
	date?: Date;
	direction?: "OUT" | "IN";
	entryKind?: "STANDARD" | "STARTING_BALANCE" | "ADJUSTMENT" | "NOT_SPENDING";
	inType?: "INCOME" | "REFUND";
	status?: "DRAFT" | "FINALIZED";
	hidden?: boolean;
	amortizedParent?: boolean;
	categoryId?: string;
	booked?: { currency: string; amount: string; rate: string };
};

async function addExpense(userId: string, e: Exp) {
	await adminDb.expense.create({
		data: {
			id: randomUUID(),
			userId,
			title: "row",
			amount: D(e.amount),
			currency: e.currency ?? "ARS",
			date: e.date ?? MID,
			categoryId: e.categoryId ?? null,
			amountInUSD: D(e.amountInUSD),
			exchangeRate: D(1500),
			pricingSource: "MANUAL",
			status: e.status ?? "FINALIZED",
			direction: e.direction ?? "OUT",
			entryKind: e.entryKind ?? "STANDARD",
			inType: e.inType ?? null,
			excludeFromAnalytics: e.hidden ?? false,
			isAmortizedParent: e.amortizedParent ?? false,
			...(e.booked
				? {
						rateType: "blue",
						homeCurrency: e.booked.currency,
						homeAmount: D(e.booked.amount),
						homeRate: D(e.booked.rate),
					}
				: {}),
		},
	});
}

async function addShare(
	userId: string,
	s: {
		amount: string;
		currency?: string;
		rate?: string;
		date?: Date;
		status?: "PENDING" | "REJECTED";
		projectId?: string;
	},
	bobId: string,
) {
	const id = randomUUID();
	await adminDb.sharedTransaction.create({
		data: {
			id,
			description: "dinner",
			amount: D(s.amount),
			currency: s.currency ?? "ARS",
			date: s.date ?? MID,
			exchangeRate: s.rate ? D(s.rate) : null,
			paidByType: "user",
			paidById: bobId,
			createdByType: "user",
			createdById: bobId,
			projectId: s.projectId ?? null,
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
		await adminDb.expense.findMany({
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
	const hidden = await adminDb.projectParticipant.findMany({
		where: { participantId: userId, excludeFromAnalytics: true },
	});
	return { expenses, shares, hiddenProjectIds: hidden.map((h) => h.projectId) };
}

const exact = (g: SpentGroup) => ({
	...g,
	amount: dec(g.amount).toFixed(),
	amountInUSD: dec(g.amountInUSD).toFixed(),
	homeAmount: dec(g.homeAmount).toFixed(),
});
const byKey = (g: SpentGroup) => `${g.currency}/${g.homeCurrency}`;
const groups = (l: SpentGroup[]) =>
	l.map(exact).sort((a, b) => byKey(a).localeCompare(byKey(b)));
const shares = (l: SpentInputs["shares"]) =>
	[...l].sort(
		(a, b) => a.amount - b.amount || a.currency.localeCompare(b.currency),
	);
const figureOrder = <T extends { currency: string }>(l: T[]) =>
	[...l].sort((a, b) => a.currency.localeCompare(b.currency));

let userId: string;
let rateless: string;

beforeAll(async () => {
	const { user } = await createTestUser();
	const { user: bob } = await createTestUser();
	userId = user.id;
	await adminDb.user.update({
		where: { id: userId },
		data: { homeCurrency: "ARS", timeZone: BA },
	});
	const income = await ensureIncomeCategories(adminDb, userId);
	const salary = income.find((c) => c.name === "Salary")?.id;

	const own = (e: Exp) => addExpense(userId, e);
	await own({
		amount: "1000.50",
		amountInUSD: "0.67",
		date: new Date("2026-10-01T01:30:00Z"),
	});
	await own({
		amount: "250.25",
		amountInUSD: "0.17",
		date: new Date("2026-11-01T01:30:00Z"),
	});
	await own({ amount: "10000", amountInUSD: "6.67" });
	await own({
		amount: "100",
		currency: "USD",
		amountInUSD: "100",
		booked: { currency: "ARS", amount: "150000", rate: "1500" },
	});
	await own({ amount: "1234", currency: "JPY", amountInUSD: "8" });
	await own({ amount: "766", currency: "JPY", amountInUSD: "5" });
	await own({ amount: "12.345", currency: "KWD", amountInUSD: "40" });
	await own({ amount: "1.2345", currency: "KWD", amountInUSD: "4" });
	await own({
		amount: "1.2355",
		currency: "KWD",
		amountInUSD: "4",
		booked: { currency: "ARS", amount: "3706.50", rate: "3000" },
	});
	await own({
		amount: "1500",
		amountInUSD: "1",
		direction: "IN",
		inType: "REFUND",
	});
	// Never counted.
	await own({
		amount: "900",
		amountInUSD: "1",
		direction: "IN",
		inType: "INCOME",
		categoryId: salary,
	});
	await own({ amount: "900", amountInUSD: "1", categoryId: salary });
	await own({ amount: "900", amountInUSD: "1", entryKind: "NOT_SPENDING" });
	await own({
		amount: "900",
		amountInUSD: "1",
		entryKind: "STARTING_BALANCE",
		direction: "IN",
	});
	await own({ amount: "900", amountInUSD: "1", entryKind: "ADJUSTMENT" });
	await own({ amount: "900", amountInUSD: "1", status: "DRAFT" });
	await own({ amount: "900", amountInUSD: "1", hidden: true });
	await own({ amount: "900", amountInUSD: "1", amortizedParent: true });
	await own({
		amount: "900",
		amountInUSD: "1",
		date: new Date("2026-09-10T12:00:00Z"),
	});

	const project = await adminDb.project.create({
		data: { name: "Hidden trip", createdById: bob.id },
	});
	await adminDb.projectParticipant.create({
		data: {
			projectId: project.id,
			participantType: "user",
			participantId: userId,
			excludeFromAnalytics: true,
		},
	});
	const share = (s: Parameters<typeof addShare>[1]) =>
		addShare(userId, s, bob.id);
	await share({ amount: "75000", rate: "1500" });
	await share({
		amount: "20",
		rate: "1500",
		date: new Date("2026-11-01T01:30:00Z"),
	});
	await share({ amount: "12.50", currency: "USD" });
	await share({ amount: "7", rate: "1500", status: "REJECTED" });
	await share({ amount: "8", rate: "1500", projectId: project.id });

	// A second person whose only share is in a currency no rate exists for.
	const { user: other } = await createTestUser();
	rateless = other.id;
	await adminDb.user.update({
		where: { id: rateless },
		data: { timeZone: "UTC" },
	});
	await addExpense(rateless, { amount: "100", amountInUSD: "0.07" });
	await addShare(rateless, { amount: "500", currency: "XQZ" }, bob.id);
});

const sql = (id: string, zone: string) => {
	const range = spentRange(NOW, 1, zone);
	return userTransaction(adminDb, id, (tx) =>
		loadSpentInputs(tx, {
			userId: id,
			date: { gte: range.start, lte: range.end },
		}),
	);
};
const device = async (id: string, zone: string) =>
	spentInputsFromRows({
		...(await rawRows(id)),
		range: spentRange(NOW, 1, zone),
	});

describe.each([BA, "UTC"])("spent loaders in %s", (zone) => {
	it("the SQL loader and the device loader read the same inputs, digit for digit", async () => {
		const a = await sql(userId, zone);
		const b = await device(userId, zone);
		expect(groups(a.spending)).toEqual(groups(b.spending));
		expect(groups(a.refunds)).toEqual(groups(b.refunds));
		expect(shares(a.shares)).toEqual(shares(b.shares));
		expect(figureOrder(spentMinorByCurrency(a))).toEqual(
			figureOrder(spentMinorByCurrency(b)),
		);
		expect(spentItemsOf(a).length).toBe(spentItemsOf(b).length);
		expect(sumIn(spentItemsOf(a), "ARS", 1500)).toBe(
			sumIn(spentItemsOf(b), "ARS", 1500),
		);
	});
});

describe("the figure over the saved zone", () => {
	const at = (zone: string) =>
		adminDb.user
			.update({ where: { id: userId }, data: { timeZone: zone } })
			.then(() =>
				userTransaction(adminDb, userId, (tx) => spentAt(tx, userId, NOW)),
			)
			.then(figureOrder);

	it("Buenos Aires October, by hand", async () => {
		expect(await at(BA)).toEqual([
			{ minor: 8_377_025, currency: "ARS" },
			{ minor: 2_000, currency: "JPY" },
			{ minor: 14_816, currency: "KWD" },
			{ minor: 11_250, currency: "USD" },
		]);
	});

	it("UTC October moves the two rows at the month edges", async () => {
		expect(await at("UTC")).toEqual([
			{ minor: 8_450_050, currency: "ARS" },
			{ minor: 2_000, currency: "JPY" },
			{ minor: 14_816, currency: "KWD" },
			{ minor: 11_250, currency: "USD" },
		]);
	});

	it("matches the device compute on the same rows", async () => {
		const served = await at(BA);
		const pure = spentMinorByCurrency(await device(userId, BA));
		expect(served).toEqual(figureOrder(pure));
	});
});

describe("home totals through the totals rule", () => {
	it("ARS at blue 1,500, hand-derived, equal on both loaders", async () => {
		const range = spentRange(NOW, 1, BA);
		const total = await userTransaction(adminDb, userId, (tx) =>
			spentIn(
				tx,
				{ userId, date: { gte: range.start, lte: range.end } },
				"ARS",
				1500,
			),
		);
		expect(total).toBeCloseTo(341_726.75, 6);
		expect(sumIn(spentItemsOf(await device(userId, BA)), "ARS", 1500)).toBe(
			total,
		);
	});

	it("a share with no rate at all throws on both, and counts in its own currency", async () => {
		const range = {
			gte: spentRange(NOW, 1, "UTC").start,
			lte: spentRange(NOW, 1, "UTC").end,
		};
		await expect(
			userTransaction(adminDb, rateless, (tx) =>
				spentIn(tx, { userId: rateless, date: range }, "ARS", 1500),
			),
		).rejects.toThrow(MissingRateError);
		const b = await device(rateless, "UTC");
		expect(() => sumIn(spentItemsOf(b), "ARS", 1500)).toThrow(MissingRateError);
		expect(spentMinorByCurrency(b)).toEqual([
			{ minor: 10_000, currency: "ARS" },
			{ minor: 50_000, currency: "XQZ" },
		]);
	});
});
