/**
 * Characterization of the 12 budget and envelope figures (budget.* and
 * envelope.*) read through readFigures, with hand-derived values, so moving
 * the view code out of the server cannot change a digit unnoticed. Every
 * expected value below is derived from the engine's rules (SPEC §5.3: Left,
 * Carry, ToAssign) and the valuation rules (§5.12), never from a run.
 *
 * Setting: an ARS book (2 decimals), Buenos Aires (UTC-3, no DST), the month
 * starting on the 5th, the clock 2026-11-14T15:00Z (Nov 14, 12:00 local), so
 * the current budget month is 202611 (Nov 5 to Dec 4). ARS per USD: blue
 * 1,500 and official 1,000, both dated 2026-10-01 (before every row, so
 * nothing is approximate). The book's period rate type is set to blue
 * explicitly; the setup would pick official.
 *
 * World A, the vector (style SAVE_FIRST: it funds nothing at setup; the
 * style does not move any of these numbers, the styles below read the same
 * way). Starting money 1,000,000.00. Targets: Rent 100,000.00 Set aside,
 * Dining 250,000.00 Refill. Dining assigned 300,000.00 for Nov. Rows, all
 * Dining and dated Nov 6 to 10 (local days):
 *   ARS 30,000.00                               30,000.00 as entered
 *   USD 10 booked ARS 14,500.00                 14,500.00 as booked
 *   USD 10 no booked value                      10 x 1,500 = 15,000.00
 *   refund ARS 2,000.00                         -2,000.00
 *   USD 60 split, you paid, 30 / 30 with Bob    your 30 x 1,500 = 45,000.00
 *   income ARS 150,000.00
 * and a USD 1,000 liability (a card), which a Wealth account keeps out of the
 * everyday budget.
 *   Dining spent = 30,000 + 14,500 + 15,000 - 2,000 + 45,000       = 102,500.00
 *   Dining left  = 300,000 - 102,500                                = 197,500.00
 *   Held for others: Bob's 30 USD front, 30 x 1,500                =  45,000.00
 *   Money in = the income; the starting balance has its own term   = 150,000.00
 *   Not planned yet = ToAssign = (1,000,000 + 150,000) - 300,000 - 45,000
 *                                                                   = 805,000.00
 *   Left to spend = Σ Left of the Spending group (Dining 197,500 and the
 *     default envelope 0) + min(0, ToAssign)                        = 197,500.00
 *   Holds = ToAssign + Σ Left (Rent 0, Dining 197,500, default 0)   = 1,002,500.00
 *     (= 1,150,000 - 102,500 - 45,000, SPEC §5.3's invariant)
 *   Plan cost = Σ targets this month = 100,000 + 250,000            = 350,000.00
 *   Typical income: the book began this month, no closed month      = unavailable
 *   Total debt = 1,000 USD at blue 1,500                            = 1,500,000.00
 *   Left this week and Left in limits: no weekly envelope, not Limits
 *
 * The other worlds each pin what their name says; amounts are in the book
 * currency. A book's membership is not part of this file: findPersonalBook
 * ignores membership while sync tombstones a shared book, a known divergence
 * recorded in the P13b plan, and no app path adds a member (book.service.ts).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { seedUser } from "./__tests__/pg-fixture";
import { setupEnvelopeBook } from "./setup.mutation";

const NOW = new Date("2026-11-14T15:00:00Z");
const ZONE = "America/Argentina/Buenos_Aires";

const IDS = [
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

type Seeded = Awaited<ReturnType<typeof seedUser>>;
type Plan = {
	style: SetupInput["style"];
	startingMinor?: number;
	rentMinor: number;
	diningMinor: number;
	weeklyDining?: boolean;
	percentGroups?: boolean;
};

function setupOf(s: Seeded, o: Plan): SetupInput {
	const pct = (basisPoints: number) =>
		o.percentGroups
			? { target: { kind: "PERCENT_OF_INCOME" as const, basisPoints } }
			: {};
	const groups: SetupInput["groups"] = [
		{ key: "bills", name: "Bills", role: "BILLS", ...pct(5000) },
		{ key: "spending", name: "Spending", role: "SPENDING", ...pct(3000) },
		...(o.percentGroups
			? [
					{
						key: "savings",
						name: "Savings",
						role: "SAVINGS" as const,
						...pct(2000),
					},
				]
			: []),
	];
	return {
		style: o.style,
		...(o.startingMinor === undefined
			? {}
			: { startingMoneyMinor: o.startingMinor }),
		weekStartDay: 1,
		groups,
		envelopes: [
			{
				key: "rent",
				name: "Rent",
				groupKey: "bills",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [s.rent],
				target: {
					kind: "MONTHLY",
					amountMinor: o.rentMinor,
					mode: "SET_ASIDE",
					cadence: "MONTH",
				},
			},
			{
				key: "dining",
				name: "Dining",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [s.dining],
				target: {
					kind: "MONTHLY",
					amountMinor: o.diningMinor,
					mode: "REFILL",
					cadence: o.weeklyDining ? "WEEK" : "MONTH",
				},
			},
			{
				key: "spending",
				name: "Spending",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
			},
		],
	};
}

/** The rates the worlds read: units per USD, dated before every row. */
const RATES = [
	["ARS", "blue", "2026-10-01", "1500"],
	["ARS", "official", "2026-10-01", "1000"],
	["JPY", "official", "2026-10-01", "150"],
	["KWD", "official", "2026-10-01", "0.3"],
	// After the rows it prices: nothing is on or before them, so they read the nearest.
	["ARS", "mep", "2026-11-20", "1200"],
] as const;

const rateRow = ([currency, type, day]: (typeof RATES)[number]) => ({
	date: new Date(`${day}T00:00:00.000Z`),
	currency,
	type,
});

async function upsertRate(
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

beforeAll(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	for (const [currency, type, day, rate] of RATES)
		await upsertRate(currency, type, day, rate);
});

afterAll(async () => {
	vi.useRealTimers();
	await adminDb.exchangeRate.deleteMany({ where: { OR: RATES.map(rateRow) } });
});

const money = (minor: number, currency = "ARS") => [{ minor, currency }];

interface World extends Seeded {
	bookId: string;
	ids: Record<string, string>;
	currency: string;
	perUsd: string;
}

async function world(
	o: Plan & {
		currency?: string;
		perUsd?: string;
		setupAt?: Date;
		settingsZone?: string;
		rateType?: string;
	},
): Promise<World> {
	const currency = o.currency ?? "ARS";
	vi.setSystemTime(o.setupAt ?? NOW);
	const s = await seedUser();
	await adminDb.user.update({
		where: { id: s.user.id },
		data: {
			homeCurrency: currency,
			fiscalMonthStartDay: 5,
			timeZone: o.settingsZone ?? ZONE,
		},
	});
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupOf(s, o),
		currency,
		timeZone: ZONE,
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	if (o.rateType)
		await adminDb.bookPeriod.updateMany({
			where: { bookId: book.id },
			data: { rateType: o.rateType },
		});
	vi.setSystemTime(NOW);
	return {
		...s,
		bookId: book.id,
		ids: Object.fromEntries(book.envelopes.map((e) => [e.name, e.id])),
		currency,
		perUsd: o.perUsd ?? "1500",
	};
}

function row(
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
	const currency = o.currency ?? w.currency;
	const amount = new Prisma.Decimal(o.amount);
	return fixtureDb.expense.create({
		data: {
			userId: w.user.id,
			title: "Row",
			amount,
			currency,
			date: new Date(o.at),
			categoryId: o.categoryId === undefined ? w.dining : o.categoryId,
			amountInUSD:
				currency === "USD" ? amount : amount.div(w.perUsd).toDecimalPlaces(8),
			exchangeRate: currency === "USD" ? 1 : new Prisma.Decimal(w.perUsd),
			pricingSource: "MANUAL",
			direction: o.direction ?? "OUT",
			entryKind: "STANDARD",
			inType: o.inType ?? null,
			...(o.booked
				? {
						homeCurrency: w.currency,
						homeAmount: new Prisma.Decimal(o.booked),
						homeRate: new Prisma.Decimal(o.booked).div(amount),
					}
				: {}),
		},
	});
}

/** Assigned money for a month, as a stored movement in major units of the book currency. */
function assigned(w: World, month: number, envelope: string, amount: string) {
	return adminDb.budgetMovement.create({
		data: {
			id: randomUUID(),
			bookId: w.bookId,
			month,
			toEnvelopeId: w.ids[envelope] as string,
			amount,
			kind: "ASSIGN",
			actorUserId: w.user.id,
		},
	});
}

async function read(w: World, envelope = "Dining") {
	return Object.fromEntries(
		await readFigures(w.user.id, IDS, { envelopeId: w.ids[envelope] }),
	);
}

const NONE = Object.fromEntries(IDS.map((id) => [id, null]));

describe("the vector: an ARS book valued at blue, home ARS", () => {
	let w: World;

	beforeAll(async () => {
		w = await world({
			style: "SAVE_FIRST",
			startingMinor: 100_000_000,
			rentMinor: 10_000_000,
			diningMinor: 25_000_000,
			rateType: "blue",
		});
		await assigned(w, 202611, "Dining", "300000");
		await row(w, { amount: "30000", at: "2026-11-06T15:00:00Z" });
		await row(w, {
			amount: "10",
			currency: "USD",
			at: "2026-11-07T15:00:00Z",
			booked: "14500",
		});
		await row(w, {
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
			data: { createdById: w.user.id, name: "Bob" },
		});
		await adminDb.sharedTransaction.create({
			data: {
				description: "Split",
				amount: new Prisma.Decimal(60),
				currency: "USD",
				date: new Date("2026-11-10T15:00:00Z"),
				categoryId: w.dining,
				paidByType: "user",
				paidById: w.user.id,
				createdByType: "user",
				createdById: w.user.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: w.user.id,
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
		});
		await fixtureDb.assetAccount.create({
			data: {
				userId: w.user.id,
				name: "Visa",
				type: "LIABILITY_CREDIT_CARD",
				currency: "USD",
				balance: new Prisma.Decimal(1000),
			},
		});
	});

	it("reads all twelve figures as derived", async () => {
		expect(await read(w)).toEqual({
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
		});
	});

	it("reads another envelope's own two figures", async () => {
		// Rent has nothing assigned and no row: spent 0, left 0, and Dining's rows are not its own.
		const r = await read(w, "Rent");
		expect(r["envelope.left"]).toEqual(money(0));
		expect(r["envelope.spent"]).toEqual(money(0));
	});

	it("reads an unknown envelope as unavailable", async () => {
		const r = await readFigures(
			w.user.id,
			["envelope.left", "envelope.spent"],
			{
				envelopeId: randomUUID(),
			},
		);
		expect(r.get("envelope.left")).toBeNull();
		expect(r.get("envelope.spent")).toBeNull();
	});

	it("reads every figure that depends on a rate as unavailable when the book's rate type has none", async () => {
		await adminDb.bookPeriod.updateMany({
			where: { bookId: w.bookId },
			data: { rateType: "XQZ" },
		});
		// The unbooked USD row and the USD debt have no XQZ rate. Left this week
		// and Left in limits are unavailable in this style anyway.
		expect(await read(w)).toEqual(NONE);
	});
});

describe("a row at the month boundary, the book's zone differing from the settings zone", () => {
	/**
	 * The book began Oct 5 (setup on Oct 14); the settings zone is UTC. Two
	 * rows on Nov 5 UTC: 02:30Z is Nov 4, 23:30 in the book's zone (October),
	 * 03:10Z is Nov 5, 00:10 (November). In UTC both would be November.
	 *   Dining Oct: assigned 0, activity -1,000.00, Left -1,000.00. A Monthly
	 *     envelope carries max(0, Left), so the overspend is taken from To assign.
	 *   Dining Nov: carry 0, assigned 500,000.00, activity -2,000.00,
	 *     Left 498,000.00; spent 2,000.00 (October's row is not in it).
	 *   ToAssign(Nov) = 1,000,000 - 500,000 - 1,000 (overspend taken) = 499,000.00
	 *   Left to spend = 498,000 (Dining) + 0 (default envelope)       = 498,000.00
	 *   Holds = 499,000 + 498,000 = 997,000.00 = 1,000,000 - 3,000 spent
	 *   Plan cost = 100,000 + 250,000 = 350,000.00
	 *   Typical income: one closed month (October), no income in it: ARS 0.00
	 *     (the median of [0]; no rate is involved)
	 *   Total debt: no liability, ARS 0.00
	 */
	it("dates a row in the book's zone", async () => {
		const w = await world({
			style: "SAVE_FIRST",
			setupAt: new Date("2026-10-14T15:00:00Z"),
			settingsZone: "UTC",
			startingMinor: 100_000_000,
			rentMinor: 10_000_000,
			diningMinor: 25_000_000,
			rateType: "blue",
		});
		await assigned(w, 202611, "Dining", "500000");
		await row(w, { amount: "1000", at: "2026-11-05T02:30:00Z" });
		await row(w, { amount: "2000", at: "2026-11-05T03:10:00Z" });
		expect(await read(w)).toEqual({
			"budget.notPlannedYet": money(49_900_000),
			"budget.leftToSpend": money(49_800_000),
			"budget.leftThisWeek": null,
			"budget.leftInLimits": null,
			"envelope.left": money(49_800_000),
			"envelope.spent": money(200_000),
			"budget.moneyIn": money(0),
			"budget.heldForOthers": money(0),
			"budget.holds": money(99_700_000),
			"budget.planCost": money(35_000_000),
			"budget.typicalIncome": money(0),
			"budget.totalDebt": money(0),
		});
	});
});

describe("a value frozen at first sight", () => {
	/**
	 * USD 10 with no booked value on Nov 6, blue 1,400 when first read:
	 * 14,000.00, kept in budget_row_value. The rate row is then rewritten to
	 * 1,500 (the daily sync moves a row in place): the same row still reads
	 * 14,000.00, while a second USD 10 row added afterwards is valued at the
	 * rate now, 15,000.00.
	 */
	it("keeps the value a row was first read at", async () => {
		await upsertRate("ARS", "blue", "2026-10-01", "1400");
		try {
			const w = await world({
				style: "SAVE_FIRST",
				rentMinor: 10_000_000,
				diningMinor: 25_000_000,
				rateType: "blue",
			});
			await row(w, {
				amount: "10",
				currency: "USD",
				at: "2026-11-06T15:00:00Z",
			});
			expect((await read(w))["envelope.spent"]).toEqual(money(1_400_000));
			const frozen = await adminDb.budgetRowValue.findMany({
				where: { bookId: w.bookId },
			});
			expect(frozen.map((f) => [f.minor, f.approximate])).toEqual([
				[1_400_000n, false],
			]);

			await upsertRate("ARS", "blue", "2026-10-01", "1500");
			expect((await read(w))["envelope.spent"]).toEqual(money(1_400_000));
			await row(w, {
				amount: "10",
				currency: "USD",
				at: "2026-11-07T15:00:00Z",
			});
			expect((await read(w))["envelope.spent"]).toEqual(
				money(1_400_000 + 1_500_000),
			);
			expect(
				(await adminDb.budgetRowValue.findMany({ where: { bookId: w.bookId } }))
					.map((f) => f.minor)
					.sort(),
			).toEqual([1_400_000n, 1_500_000n]);
		} finally {
			await upsertRate("ARS", "blue", "2026-10-01", "1500");
		}
	});
});

describe("a value at the nearest rate", () => {
	/**
	 * The only ARS mep rate is dated Nov 20, after the row (Nov 6): nothing is
	 * on or before it, so USD 10 reads 10 x 1,200 = 12,000.00, flagged
	 * approximate, and the figures stay available.
	 */
	it("is valued, flagged approximate and frozen", async () => {
		const w = await world({
			style: "SAVE_FIRST",
			rentMinor: 10_000_000,
			diningMinor: 25_000_000,
			rateType: "mep",
		});
		await row(w, { amount: "10", currency: "USD", at: "2026-11-06T15:00:00Z" });
		expect((await read(w))["envelope.spent"]).toEqual(money(1_200_000));
		const frozen = await adminDb.budgetRowValue.findMany({
			where: { bookId: w.bookId },
		});
		expect(
			frozen.map((f) => [f.minor, f.approximate, f.rateDate?.toISOString()]),
		).toEqual([[1_200_000n, true, "2026-11-20T00:00:00.000Z"]]);
	});
});

describe("typical income and percent groups", () => {
	/**
	 * The book began Aug 5 (setup on Aug 14), no starting money. Income of
	 * ARS 100,000.00 on Aug 10, 150,000.00 on Sep 10, 120,000.00 on Oct 10:
	 * the last three closed months, median 120,000.00. Nothing in November, so
	 * the % base is the typical income 120,000.00 (12,000,000 minor).
	 * Groups 50 / 30 / 20 percent: Bills 6,000,000, Spending 3,600,000,
	 * Savings 2,400,000 minor. Targets: Rent 4,000,000 in Bills (below its
	 * group's 6,000,000), Dining 5,000,000 in Spending (above 3,600,000).
	 *   Plan cost = max(4,000,000; 6,000,000) + max(5,000,000; 3,600,000)
	 *               + 2,400,000 (Savings, no envelope)  = 13,400,000
	 *   Money in = 370,000.00, nothing assigned or spent, so Not planned yet,
	 *   Holds and Left to spend (the Spending group holds 0) read:
	 *   370,000.00 / 370,000.00 / 0.00
	 */
	it("reads typical income and the plan cost the groups size", async () => {
		const w = await world({
			style: "FIFTY_THIRTY_TWENTY",
			setupAt: new Date("2026-08-14T15:00:00Z"),
			rentMinor: 4_000_000,
			diningMinor: 5_000_000,
			percentGroups: true,
			rateType: "blue",
		});
		for (const [amount, at] of [
			["100000", "2026-08-10T15:00:00Z"],
			["150000", "2026-09-10T15:00:00Z"],
			["120000", "2026-10-10T15:00:00Z"],
		] as const)
			await row(w, {
				amount,
				at,
				categoryId: null,
				direction: "IN",
				inType: "INCOME",
			});
		expect(await read(w)).toEqual({
			"budget.notPlannedYet": money(37_000_000),
			"budget.leftToSpend": money(0),
			"budget.leftThisWeek": null,
			"budget.leftInLimits": null,
			"envelope.left": money(0),
			"envelope.spent": money(0),
			"budget.moneyIn": money(37_000_000),
			"budget.heldForOthers": money(0),
			"budget.holds": money(37_000_000),
			"budget.planCost": money(13_400_000),
			"budget.typicalIncome": money(12_000_000),
			"budget.totalDebt": money(0),
		});
	});
});

describe("styles with their own figure", () => {
	/**
	 * Limits (plan-funded): setup funds each limit from its target, Rent
	 * 50,000.00 and Dining 100,000.00. Dining spends ARS 30,000.00 on Nov 6.
	 * Left in limits = Σ Left of the envelopes with a limit
	 *   = 50,000 + (100,000 - 30,000) = 120,000.00.
	 * Nothing came in, so Not planned yet = -150,000.00 (planned more than
	 * there is), Left to spend = 70,000 + min(0, -150,000) = -80,000.00 and
	 * Holds = -150,000 + 120,000 = -30,000.00 (= -30,000 spent).
	 * Plan cost = 150,000.00.
	 */
	it("reads Left in limits in a Limits book", async () => {
		const w = await world({
			style: "LIMITS",
			rentMinor: 5_000_000,
			diningMinor: 10_000_000,
			rateType: "blue",
		});
		await row(w, { amount: "30000", at: "2026-11-06T15:00:00Z" });
		expect(await read(w)).toEqual({
			"budget.notPlannedYet": money(-15_000_000),
			"budget.leftToSpend": money(-8_000_000),
			"budget.leftThisWeek": null,
			"budget.leftInLimits": money(12_000_000),
			"envelope.left": money(7_000_000),
			"envelope.spent": money(3_000_000),
			"budget.moneyIn": money(0),
			"budget.heldForOthers": money(0),
			"budget.holds": money(-3_000_000),
			"budget.planCost": money(15_000_000),
			"budget.typicalIncome": null,
			"budget.totalDebt": money(0),
		});
	});

	/**
	 * Weekly: Dining 20,000.00 a week, Monday weeks. The month Nov 5 to Dec 4
	 * has four weeks (Nov 5 to 15, 16 to 22, 23 to 29, Nov 30 to Dec 4), and
	 * Nov 14 is in week 1. Dining is assigned 80,000.00 (4 x 20,000) and
	 * spends 15,000.00 on Nov 6, so Left is 65,000.00 and
	 * Left this week = min(Left, carry + weekly x week - spent so far)
	 *   = min(65,000; 0 + 20,000 x 1 - 15,000) = 5,000.00.
	 * Nothing came in: Not planned yet = -80,000.00, Left to spend =
	 * 65,000 + min(0, -80,000) = -15,000.00, Holds = -80,000 + 65,000 =
	 * -15,000.00. Plan cost = Rent 100,000 + Dining 4 x 20,000 = 180,000.00.
	 */
	it("reads Left this week in a Weekly book", async () => {
		const w = await world({
			style: "WEEKLY",
			rentMinor: 10_000_000,
			diningMinor: 2_000_000,
			weeklyDining: true,
			rateType: "blue",
		});
		await assigned(w, 202611, "Dining", "80000");
		await row(w, { amount: "15000", at: "2026-11-06T15:00:00Z" });
		expect(await read(w)).toEqual({
			"budget.notPlannedYet": money(-8_000_000),
			"budget.leftToSpend": money(-1_500_000),
			"budget.leftThisWeek": money(500_000),
			"budget.leftInLimits": null,
			"envelope.left": money(6_500_000),
			"envelope.spent": money(1_500_000),
			"budget.moneyIn": money(0),
			"budget.heldForOthers": money(0),
			"budget.holds": money(-1_500_000),
			"budget.planCost": money(18_000_000),
			"budget.typicalIncome": null,
			"budget.totalDebt": money(0),
		});
	});
});

describe("books in currencies with other decimals", () => {
	/**
	 * JPY (no decimals; official 150 per USD): starting money 500,000, Dining
	 * assigned 100,000, spending JPY 3,000 and USD 10 (10 x 150 = 1,500).
	 *   spent 4,500; left 95,500; Not planned yet 500,000 - 100,000 = 400,000;
	 *   Holds 400,000 + 95,500 = 495,500 (= 500,000 - 4,500).
	 * Targets Rent 50,000 and Dining 20,000: plan cost 70,000.
	 */
	it("reads a JPY book in whole yen", async () => {
		const w = await world({
			style: "SAVE_FIRST",
			currency: "JPY",
			perUsd: "150",
			startingMinor: 500_000,
			rentMinor: 50_000,
			diningMinor: 20_000,
		});
		await assigned(w, 202611, "Dining", "100000");
		await row(w, { amount: "3000", at: "2026-11-06T15:00:00Z" });
		await row(w, {
			amount: "10",
			currency: "USD",
			at: "2026-11-07T15:00:00Z",
		});
		const r = await read(w);
		expect(r["envelope.spent"]).toEqual(money(4_500, "JPY"));
		expect(r["envelope.left"]).toEqual(money(95_500, "JPY"));
		expect(r["budget.notPlannedYet"]).toEqual(money(400_000, "JPY"));
		expect(r["budget.holds"]).toEqual(money(495_500, "JPY"));
		expect(r["budget.leftToSpend"]).toEqual(money(95_500, "JPY"));
		expect(r["budget.moneyIn"]).toEqual(money(0, "JPY"));
		expect(r["budget.planCost"]).toEqual(money(70_000, "JPY"));
	});

	/**
	 * KWD (three decimals; official 0.3 per USD): starting money 1,000.000,
	 * Dining assigned 300.000, spending KWD 30.500 and USD 10 (10 x 0.3 =
	 * 3.000).
	 *   spent 33.500; left 266.500; Not planned yet 700.000;
	 *   Holds 700.000 + 266.500 = 966.500 (= 1,000.000 - 33.500).
	 * Targets Rent 100.000 and Dining 50.000: plan cost 150.000.
	 */
	it("reads a KWD book in fils", async () => {
		const w = await world({
			style: "SAVE_FIRST",
			currency: "KWD",
			perUsd: "0.3",
			startingMinor: 1_000_000,
			rentMinor: 100_000,
			diningMinor: 50_000,
		});
		await assigned(w, 202611, "Dining", "300");
		await row(w, { amount: "30.5", at: "2026-11-06T15:00:00Z" });
		await row(w, {
			amount: "10",
			currency: "USD",
			at: "2026-11-07T15:00:00Z",
		});
		const r = await read(w);
		expect(r["envelope.spent"]).toEqual(money(33_500, "KWD"));
		expect(r["envelope.left"]).toEqual(money(266_500, "KWD"));
		expect(r["budget.notPlannedYet"]).toEqual(money(700_000, "KWD"));
		expect(r["budget.holds"]).toEqual(money(966_500, "KWD"));
		expect(r["budget.planCost"]).toEqual(money(150_000, "KWD"));
	});
});

describe("a book without a default envelope", () => {
	it("is unavailable like Just track, in every figure", async () => {
		const w = await world({
			style: "SAVE_FIRST",
			startingMinor: 100_000_000,
			rentMinor: 10_000_000,
			diningMinor: 25_000_000,
		});
		await adminDb.budgetBook.update({
			where: { id: w.bookId },
			data: { defaultEnvelopeId: null },
		});
		expect(await read(w)).toEqual(NONE);
	});
});
