/**
 * Totals in exact decimals on real Postgres, home currency ARS at blue 1,545
 * per USD (money-decimal PR 3a). The SUMs come back from numeric as Decimals
 * and add to the cent with no float in between.
 *
 * Month ledger, all in October 2026 (Buenos Aires), expected by hand:
 *   own ARS 15,450.55 + booked USD 20 saved at ARS 30,000          = 45,450.55
 *   USD of the rest, unbooked: 10.01 USD + 3 x 0.10 USD (EUR rows)
 *     + a 100 USD share (no captured rate, USD is 1) - a 3 USD refund
 *     = 10.01 + 0.30 + 100 - 3 = 107.31 USD; x 1,545 = 165,793.95
 *     (107 x 1,545 = 165,315; 0.31 x 1,545 = 478.95)
 *   total = 45,450.55 + 165,793.95 = 211,244.50 ARS = 21,124,450 minor
 */
import { randomUUID } from "node:crypto";
import { roundMoneyDec } from "@retrospend/domain/money-dec";
import { roundedMinor } from "@retrospend/domain/money-minor";
import { spentRange } from "@retrospend/domain/spent";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { spentIn } from "./spent";

const BA = "America/Argentina/Buenos_Aires";
const NOW = new Date("2026-10-15T12:00:00Z");
const MID = new Date("2026-10-10T12:00:00Z");
const D = (v: string) => new Prisma.Decimal(v);

type Row = {
	amount: string;
	currency?: string;
	amountInUSD: string;
	direction?: "OUT" | "IN";
	inType?: "REFUND";
	booked?: { amount: string; rate: string };
};

const expenseData = (userId: string, r: Row) => ({
	id: randomUUID(),
	userId,
	title: "row",
	amount: D(r.amount),
	currency: r.currency ?? "ARS",
	date: MID,
	amountInUSD: D(r.amountInUSD),
	exchangeRate: D("1545"),
	pricingSource: "MANUAL" as const,
	status: "FINALIZED" as const,
	direction: r.direction ?? ("OUT" as const),
	entryKind: "STANDARD" as const,
	inType: r.inType ?? null,
	...(r.booked
		? {
				rateType: "blue",
				homeCurrency: "ARS",
				homeAmount: D(r.booked.amount),
				homeRate: D(r.booked.rate),
			}
		: {}),
});

let userId: string;
let bigUserId: string;
let oneShareUser: string;
let twoSharesUser: string;
let bobId: string;

/** A share of `amount` EUR saved with `rate` EUR per USD, in the user's name. */
const eurShare = (id: string, amount: string, rate: string) =>
	adminDb.sharedTransaction.create({
		data: {
			id: randomUUID(),
			description: "lunch",
			amount: D(amount),
			currency: "EUR",
			date: MID,
			exchangeRate: D(rate),
			paidByType: "user",
			paidById: bobId,
			createdByType: "user",
			createdById: bobId,
			splitParticipants: {
				create: {
					participantType: "user",
					participantId: id,
					shareAmount: D(amount),
					verificationStatus: "PENDING",
				},
			},
		},
	});

/** Spending in `home` at `rate` for the Buenos Aires October of the ledger. */
const totalIn = (id: string, home: string, rate: number) => {
	const range = spentRange(NOW, 1, BA);
	return userTransaction(adminDb, id, (tx) =>
		spentIn(
			tx,
			{ userId: id, date: { gte: range.start, lte: range.end } },
			home,
			rate,
		),
	);
};

const total = (id: string) => {
	const range = spentRange(NOW, 1, BA);
	return userTransaction(adminDb, id, (tx) =>
		spentIn(
			tx,
			{ userId: id, date: { gte: range.start, lte: range.end } },
			"ARS",
			1545,
		),
	);
};

beforeAll(async () => {
	const { user } = await createTestUser();
	const { user: bob } = await createTestUser();
	const { user: big } = await createTestUser();
	const { user: one } = await createTestUser();
	const { user: two } = await createTestUser();
	userId = user.id;
	bigUserId = big.id;
	oneShareUser = one.id;
	twoSharesUser = two.id;
	bobId = bob.id;
	for (const id of [userId, bigUserId])
		await adminDb.user.update({
			where: { id },
			data: { homeCurrency: "ARS", timeZone: BA },
		});

	const rows: Row[] = [
		{ amount: "15450.55", amountInUSD: "10" },
		{
			amount: "20",
			currency: "USD",
			amountInUSD: "20",
			booked: { amount: "30000", rate: "1500" },
		},
		{ amount: "10.01", currency: "USD", amountInUSD: "10.01" },
		{ amount: "1", currency: "EUR", amountInUSD: "0.10" },
		{ amount: "1", currency: "EUR", amountInUSD: "0.10" },
		{ amount: "1", currency: "EUR", amountInUSD: "0.10" },
		{
			amount: "3",
			currency: "USD",
			amountInUSD: "3",
			direction: "IN",
			inType: "REFUND",
		},
	];
	await fixtureDb.expense.createMany({
		data: rows.map((r) => expenseData(userId, r)),
	});
	await adminDb.sharedTransaction.create({
		data: {
			id: randomUUID(),
			description: "dinner",
			amount: D("100"),
			currency: "USD",
			date: MID,
			paidByType: "user",
			paidById: bob.id,
			createdByType: "user",
			createdById: bob.id,
			splitParticipants: {
				create: {
					participantType: "user",
					participantId: userId,
					shareAmount: D("100"),
					verificationStatus: "PENDING",
				},
			},
		},
	});

	for (const id of [oneShareUser, twoSharesUser])
		await adminDb.user.update({
			where: { id },
			data: { homeCurrency: "JPY", timeZone: BA },
		});
	await eurShare(oneShareUser, "1", "7");
	await eurShare(twoSharesUser, "1", "13");
	await eurShare(twoSharesUser, "1", "13");

	// 1,000 rows of the largest amount a Decimal(19,8) column holds in ARS.
	await fixtureDb.expense.createMany({
		data: Array.from({ length: 1000 }, () =>
			expenseData(bigUserId, {
				amount: "99999999999.99999999",
				amountInUSD: "64724919.09",
			}),
		),
	});
});

describe("shares total from their amount and rate in a JPY home", () => {
	it("1 EUR saved at 7 per USD, JPY at 17.5: 2.5 JPY is a tie and rounds to 2", async () => {
		// 1 / 7 USD x 17.5 = 17.5 / 7 = 2.5 exactly, one division; 2 is even.
		const sum = await totalIn(oneShareUser, "JPY", 17.5);
		expect(sum.toFixed()).toBe("2.5");
		expect(roundedMinor(sum, "JPY")).toBe(2);
	});

	it("two shares of 1 EUR at 13, JPY at 22.75: 3.5 JPY is a tie and rounds to 4", async () => {
		// Each 22.75 / 13 = 1.75; together 3.5 exactly; 4 is even.
		const sum = await totalIn(twoSharesUser, "JPY", 22.75);
		expect(sum.toFixed()).toBe("3.5");
		expect(roundedMinor(sum, "JPY")).toBe(4);
	});

	it("control, not a tie: 1 EUR at 7, JPY at 17.6 is 2.5142857... and rounds to 3", async () => {
		const sum = await totalIn(oneShareUser, "JPY", 17.6); // 17.6 / 7
		expect(sum.toFixed(7)).toBe("2.5142857");
		expect(roundedMinor(sum, "JPY")).toBe(3);
	});
});

describe("totals in an ARS home at 1,545", () => {
	it("a month with booked, unbooked, refund and share rows adds to the cent", async () => {
		const sum = await total(userId);
		expect(sum.toFixed()).toBe("211244.5");
		expect(roundedMinor(sum, "ARS")).toBe(21_124_450);
	});

	it("1,000 rows of 99,999,999,999.99999999 sum exactly", async () => {
		// x 1000 moves the point three places: 99,999,999,999,999.99999
		const sum = await total(bigUserId);
		expect(sum.toFixed()).toBe("99999999999999.99999");
		// Half to even at 2 decimals: .99999 rounds up to 100,000,000,000,000.00
		expect(roundMoneyDec(sum, "ARS").toFixed(2)).toBe("100000000000000.00");
	});
});
