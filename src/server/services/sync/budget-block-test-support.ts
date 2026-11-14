/**
 * Fixtures for the budget block tests (E2EE P13b PR 1c): the 1a vector
 * (envelope/figures-money.pg.test.ts) as a world one call builds, so a test
 * can make two identical ones. An ARS book valued at blue, Buenos Aires
 * (UTC-3), the month starting on the 5th, the clock 2026-11-14T15:00Z
 * (budget month 202611, Nov 5 to Dec 4). ARS per USD: blue 1,500 and
 * official 1,000, dated 2026-10-01, before every row.
 *
 * The vector (all Dining, local days Nov 6 to 10, style SAVE_FIRST):
 *   starting money 1,000,000.00; Dining assigned 300,000.00; income 150,000.00
 *   ARS 30,000.00                              30,000.00 as entered
 *   USD 10 booked at ARS 14,500.00             14,500.00 as booked
 *   USD 10 with no booked value                10 x 1,500 = 15,000.00
 *   refund ARS 2,000.00                        -2,000.00
 *   USD 60 split, you paid, 30 / 30 with Bob   your 30 x 1,500 = 45,000.00
 *   Dining spent  = 30,000 + 14,500 + 15,000 - 2,000 + 45,000 = 102,500.00
 *   Dining left   = 300,000 - 102,500                         = 197,500.00
 *   Held for others (Bob's 30 USD, 30 x 1,500)                =  45,000.00
 *   Money in                                                  = 150,000.00
 *   Not planned yet = 1,150,000 - 300,000 - 45,000            = 805,000.00
 *   Holds = 1,150,000 - 102,500 - 45,000                      = 1,002,500.00
 *   Plan cost = Rent 100,000 + Dining 250,000                 = 350,000.00
 *   Total debt = a USD 1,000 card at blue                     = 1,500,000.00
 */
import { randomUUID } from "node:crypto";
import { columnText } from "@retrospend/domain/money-dec";
import { dec } from "@retrospend/domain/precise-decimal";
import { vi } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { seedUser } from "../envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "../envelope/setup.mutation";

export const NOW = new Date("2026-11-14T15:00:00Z");
export const ZONE = "America/Argentina/Buenos_Aires";

/** The 12 budget and envelope figures. */
export const BUDGET_IDS = [
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"budget.leftThisWeek",
	"budget.leftInLimits",
	"envelope.left",
	"envelope.spent",
	"budget.moneyIn",
	"budget.heldForOthers",
	"budget.holds",
	"budget.planCost",
	"budget.typicalIncome",
	"budget.totalDebt",
] as const;

export const money = (minor: number, currency = "ARS") => [{ minor, currency }];

/** What the vector reads, as derived above. */
export const VECTOR_FIGURES = {
	"budget.notPlannedYet": money(80_500_000),
	"budget.leftToSpend": money(19_750_000),
	"budget.leftThisWeek": null,
	"budget.leftInLimits": null,
	"envelope.left": money(19_750_000),
	"envelope.spent": money(10_250_000),
	"budget.moneyIn": money(15_000_000),
	"budget.heldForOthers": money(4_500_000),
	"budget.holds": money(100_250_000),
	"budget.planCost": money(35_000_000),
	"budget.typicalIncome": null,
	"budget.totalDebt": money(150_000_000),
};

const RATES = [
	["ARS", "blue", "2026-10-01", "1500"],
	["ARS", "official", "2026-10-01", "1000"],
] as const;

export async function upsertRate(
	currency: string,
	type: string,
	day: string,
	rate: string,
) {
	const date = new Date(`${day}T00:00:00.000Z`);
	await adminDb.exchangeRate.upsert({
		where: { date_currency_type: { date, currency, type } },
		create: { date, currency, type, rate },
		update: { rate },
	});
}

/** Fake the clock (Date only, so timers still run) and give the vector's rates. */
export async function startClock() {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	for (const [currency, type, day, rate] of RATES)
		await upsertRate(currency, type, day, rate);
}

export async function stopClock() {
	vi.useRealTimers();
	await adminDb.exchangeRate.deleteMany({
		where: {
			OR: RATES.map(([currency, type, day]) => ({
				currency,
				type,
				date: new Date(`${day}T00:00:00.000Z`),
			})),
		},
	});
}

export interface World {
	userId: string;
	bookId: string;
	rent: string;
	dining: string;
	/** Envelope ids by name. */
	envelopes: Record<string, string>;
}

export async function world(): Promise<World> {
	vi.setSystemTime(NOW);
	const s = await seedUser();
	await adminDb.user.update({
		where: { id: s.user.id },
		data: { homeCurrency: "ARS", fiscalMonthStartDay: 5, timeZone: ZONE },
	});
	const envelope = (
		key: string,
		name: string,
		category: string | null,
		extra: object,
	) => ({
		key,
		name,
		groupKey: key === "rent" ? "bills" : "spending",
		kind: "MONTHLY" as const,
		isDefault: key === "spending",
		categoryIds: category ? [category] : [],
		...extra,
	});
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		style: "SAVE_FIRST",
		startingMoneyMinor: 100_000_000,
		weekStartDay: 1,
		currency: "ARS",
		timeZone: ZONE,
		groups: [
			{ key: "bills", name: "Bills", role: "BILLS" },
			{ key: "spending", name: "Spending", role: "SPENDING" },
		],
		envelopes: [
			envelope("rent", "Rent", s.rent, {
				target: {
					kind: "MONTHLY",
					amountMinor: 10_000_000,
					mode: "SET_ASIDE",
					cadence: "MONTH",
				},
			}),
			envelope("dining", "Dining", s.dining, {
				target: {
					kind: "MONTHLY",
					amountMinor: 25_000_000,
					mode: "REFILL",
					cadence: "MONTH",
				},
			}),
			envelope("spending", "Spending", null, {}),
		],
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	await adminDb.bookPeriod.updateMany({
		where: { bookId: book.id },
		data: { rateType: "blue" },
	});
	vi.setSystemTime(NOW);
	return {
		userId: s.user.id,
		bookId: book.id,
		rent: s.rent,
		dining: s.dining,
		envelopes: Object.fromEntries(book.envelopes.map((e) => [e.name, e.id])),
	};
}

/** An expense of the user's, in ARS unless a currency is given; USD rows carry their USD value. */
export function row(
	w: World,
	o: {
		amount: string;
		at: string;
		currency?: string;
		categoryId?: string | null;
		direction?: "IN" | "OUT";
		inType?: "INCOME" | "REFUND";
		/** A value booked in the home currency at save: used as booked. */
		booked?: string;
	},
) {
	const currency = o.currency ?? "ARS";
	const amount = new Prisma.Decimal(o.amount);
	return fixtureDb.expense.create({
		data: {
			userId: w.userId,
			title: "Row",
			amount,
			currency,
			date: new Date(o.at),
			categoryId: o.categoryId === undefined ? w.dining : o.categoryId,
			amountInUSD:
				currency === "USD" ? amount : columnText(dec(o.amount).div(1500), 2),
			exchangeRate: new Prisma.Decimal(currency === "USD" ? "1" : "1500"),
			pricingSource: "MANUAL",
			direction: o.direction ?? "OUT",
			entryKind: "STANDARD",
			inType: o.inType ?? null,
			...(o.booked
				? {
						homeCurrency: "ARS",
						homeAmount: new Prisma.Decimal(o.booked),
						homeRate: columnText(dec(o.booked).div(dec(o.amount)), 12),
					}
				: {}),
		},
	});
}

export function assigned(
	w: World,
	month: number,
	envelope: string,
	amount: string,
) {
	return adminDb.budgetMovement.create({
		data: {
			id: randomUUID(),
			bookId: w.bookId,
			month,
			toEnvelopeId: w.envelopes[envelope] as string,
			amount,
			kind: "ASSIGN",
			actorUserId: w.userId,
		},
	});
}

export interface Vector extends World {
	/** The USD 10 row with no booked value: the one frozen value of the user's own. */
	unbooked: string;
	/** Your participation in the USD 60 split. */
	myShare: string;
	/** Bob's, a shadow's. */
	bobsShare: string;
	bobShadow: string;
}

/** The vector above, with a USD 1,000 card. */
export async function vector(): Promise<Vector> {
	const w = await world();
	await assigned(w, 202611, "Dining", "300000");
	await row(w, { amount: "30000", at: "2026-11-06T15:00:00Z" });
	await row(w, {
		amount: "10",
		currency: "USD",
		at: "2026-11-07T15:00:00Z",
		booked: "14500",
	});
	const unbooked = await row(w, {
		amount: "10",
		currency: "USD",
		at: "2026-11-08T15:00:00Z",
	});
	await row(w, {
		amount: "2000",
		at: "2026-11-09T15:00:00Z",
		direction: "IN",
		inType: "REFUND",
	});
	await row(w, {
		amount: "150000",
		at: "2026-11-10T15:00:00Z",
		categoryId: null,
		direction: "IN",
		inType: "INCOME",
	});
	const bob = await adminDb.shadowProfile.create({
		data: { createdById: w.userId, name: "Bob" },
		select: { id: true },
	});
	const split = await fixtureDb.sharedTransaction.create({
		data: {
			description: "Split",
			amount: new Prisma.Decimal(60),
			currency: "USD",
			date: new Date("2026-11-10T15:00:00Z"),
			categoryId: w.dining,
			paidByType: "user",
			paidById: w.userId,
			createdByType: "user",
			createdById: w.userId,
			splitParticipants: {
				create: [
					{
						participantType: "user",
						participantId: w.userId,
						shareAmount: new Prisma.Decimal(30),
						verificationStatus: "ACCEPTED",
					},
					{
						participantType: "shadow",
						participantId: bob.id,
						shareAmount: new Prisma.Decimal(30),
						verificationStatus: "ACCEPTED",
					},
				],
			},
		},
		include: { splitParticipants: true },
	});
	await fixtureDb.assetAccount.create({
		data: {
			userId: w.userId,
			name: "Visa",
			type: "LIABILITY_CREDIT_CARD",
			currency: "USD",
			balance: new Prisma.Decimal(1000),
		},
	});
	const part = (id: string) =>
		split.splitParticipants.find((p) => p.participantId === id)?.id as string;
	return {
		...w,
		unbooked: unbooked.id,
		myShare: part(w.userId),
		bobsShare: part(bob.id),
		bobShadow: bob.id,
	};
}
