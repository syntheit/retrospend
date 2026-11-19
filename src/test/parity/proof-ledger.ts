/**
 * The small ledgers of the compare proof (compare-proof.pg.test.ts), built so
 * every figure can be worked out by hand. One rate table stands under all of
 * them, with the rates the owner reads: 1 USD = 1,545 ARS at the blue rate,
 * 1,050 ARS at the official one, 0.8 EUR. A row's stored fields are written as
 * the app books them: the USD value at the rate its type names, the home leg
 * at that type when the row was booked.
 *
 * The three users, and what each proves:
 * - EUR home, Buenos Aires: ARS rows booked at blue next to ARS rows left
 *   unbooked, so the wrong rate type gives another total; rows 30 minutes
 *   either side of the November edge, which fall in December in UTC.
 * - ARS home, Buenos Aires: USD rows, one booked at official and one not,
 *   which the table prices at blue (the type it prefers).
 * - XQZ home, a currency with no rate at all: every home figure has no value.
 */
import { randomUUID } from "node:crypto";
import { adminDb, createTestUser, fixtureDb } from "../pg-harness";

export const BA = "America/Argentina/Buenos_Aires";

/** Units per USD, by "CURRENCY:type". */
const RATES: Record<string, string> = {
	"ARS:blue": "1545",
	"ARS:official": "1050",
	"EUR:official": "0.8",
	"JPY:official": "150",
	"KWD:official": "0.3",
};

/** The first of every month over the span the random ledgers draw rows from. */
function rateDates(): Date[] {
	const out: Date[] = [];
	for (let i = 0; i <= 26; i++) out.push(new Date(Date.UTC(2025, i, 1)));
	return out;
}

export interface ProofRates {
	ids: string[];
}

/**
 * The rate table. A row left by another file of the worker on the same date,
 * currency and type is replaced, so the table holds these rates on these dates.
 */
export async function seedProofRates(): Promise<ProofRates> {
	const data = rateDates().flatMap((date) =>
		Object.entries(RATES).map(([key, rate]) => {
			const [currency, type] = key.split(":") as [string, string];
			return { date, currency, type, rate };
		}),
	);
	await adminDb.exchangeRate.deleteMany({
		where: {
			OR: data.map(({ date, currency, type }) => ({ date, currency, type })),
		},
	});
	const added = await adminDb.exchangeRate.createManyAndReturn({
		data,
		select: { id: true },
	});
	return { ids: added.map((r) => r.id) };
}

export async function dropProofRates(seed: ProofRates): Promise<void> {
	await adminDb.exchangeRate.deleteMany({ where: { id: { in: seed.ids } } });
}

interface Row {
	title: string;
	/** Decimal text of the amount, in `currency`. */
	amount: string;
	currency: string;
	at: string;
	/** Stored USD value and the rate (units per USD) it was made at. */
	usd: string;
	rate: string;
	direction?: "OUT" | "IN";
	/** The home leg: the rate type, the rate (home units per unit of `currency`) and the home amount. */
	booked?: { type: string; rate: string; amount: string };
}

async function seedUser(
	home: string,
	timeZone: string,
	rows: readonly Row[],
): Promise<string> {
	const userId = (await createTestUser()).user.id;
	await adminDb.user.update({
		where: { id: userId },
		data: {
			homeCurrency: home,
			timeZone,
			fiscalMonthStartDay: 1,
			defaultRateTypes: {},
		},
	});
	for (const row of rows)
		await fixtureDb.expense.create({
			data: {
				id: randomUUID(),
				userId,
				title: row.title,
				amount: row.amount,
				currency: row.currency,
				date: new Date(row.at),
				pricingSource: "MANUAL",
				status: "FINALIZED",
				direction: row.direction ?? "OUT",
				...(row.direction === "IN" ? { inType: "INCOME" as const } : {}),
				amountInUSD: row.usd,
				exchangeRate: row.rate,
				...(row.booked
					? {
							rateType: row.booked.type,
							homeCurrency: home,
							homeRate: row.booked.rate,
							homeAmount: row.booked.amount,
						}
					: {}),
			},
		});
	return userId;
}

/**
 * EUR home. At 2026-12-01T01:30Z it is November 30 in Buenos Aires (22:30).
 * - Spent this period (November, Buenos Aires): 80 + 160 + 40 + 8 = 288.00.
 *   A is booked at blue: 154,500 / 1,545 = 100 USD, 100 x 0.8 = 80.00, frozen.
 *   B is not booked: 210,000 / 1,050 = 200 USD, 200 x 0.8 = 160.00 at the
 *   table's EUR rate. C: 50 USD = 40.00. D, at 00:30Z on December 1 (21:30 in
 *   Buenos Aires), is 10 USD = 8.00 and is November's only here.
 * - Spent last period (October): E, at 02:30Z on November 1 (23:30 on October
 *   31 in Buenos Aires), 70 USD = 56.00, and F booked at blue 309,000 / 1,545
 *   = 200 USD = 160.00: 216.00.
 * - Last period up to the same day (day 30 of 31): F alone, 160.00 (E is on
 *   the 31st).
 * - Money in: 1,000.00 EUR as entered and 100 USD = 80.00: 1,080.00.
 */
export const EUR_EXPECTED = {
	spent: { minor: 28_800, currency: "EUR" },
	spentLast: { minor: 21_600, currency: "EUR" },
	spentLastToDate: { minor: 16_000, currency: "EUR" },
	moneyIn: { minor: 108_000, currency: "EUR" },
} as const;

export const EUR_ROWS: readonly Row[] = [
	{
		title: "A",
		amount: "154500",
		currency: "ARS",
		at: "2026-11-15T15:00:00Z",
		usd: "100",
		rate: "1545",
		booked: { type: "blue", rate: "0.000517799353", amount: "80" },
	},
	{
		title: "B",
		amount: "210000",
		currency: "ARS",
		at: "2026-11-20T15:00:00Z",
		usd: "200",
		rate: "1050",
	},
	{
		title: "C",
		amount: "50",
		currency: "USD",
		at: "2026-11-30T20:00:00Z",
		usd: "50",
		rate: "1",
	},
	{
		title: "D",
		amount: "10",
		currency: "USD",
		at: "2026-12-01T00:30:00Z",
		usd: "10",
		rate: "1",
	},
	{
		title: "E",
		amount: "70",
		currency: "USD",
		at: "2026-11-01T02:30:00Z",
		usd: "70",
		rate: "1",
	},
	{
		title: "F",
		amount: "309000",
		currency: "ARS",
		at: "2026-10-10T15:00:00Z",
		usd: "200",
		rate: "1545",
		booked: { type: "blue", rate: "0.000517799353", amount: "160" },
	},
	{
		title: "Pay",
		amount: "1000",
		currency: "EUR",
		at: "2026-11-05T15:00:00Z",
		usd: "1250",
		rate: "0.8",
		direction: "IN",
		booked: { type: "official", rate: "1", amount: "1000" },
	},
	{
		title: "Income",
		amount: "100",
		currency: "USD",
		at: "2026-11-06T15:00:00Z",
		usd: "100",
		rate: "1",
		direction: "IN",
	},
];

/**
 * ARS home. P is 100 USD not booked: the table prices ARS at blue unless told
 * otherwise, 100 x 1,545 = 154,500.00. Q is 100 USD booked at official, frozen
 * at 105,000.00. Spent: 259,500.00.
 */
export const ARS_EXPECTED = {
	spent: { minor: 25_950_000, currency: "ARS" },
} as const;

export const ARS_ROWS: readonly Row[] = [
	{
		title: "P",
		amount: "100",
		currency: "USD",
		at: "2026-11-12T15:00:00Z",
		usd: "100",
		rate: "1",
	},
	{
		title: "Q",
		amount: "100",
		currency: "USD",
		at: "2026-11-14T15:00:00Z",
		usd: "100",
		rate: "1",
		booked: { type: "official", rate: "1050", amount: "105000" },
	},
];

/** XQZ home: the table has no XQZ rate, so 10 USD has no value in it. */
export const NO_RATE_ROWS: readonly Row[] = [
	{
		title: "X",
		amount: "10",
		currency: "USD",
		at: "2026-11-12T15:00:00Z",
		usd: "10",
		rate: "1",
	},
];

export interface HandLedgers {
	eur: string;
	/** The same rows with the zone stored as UTC. */
	eurUtc: string;
	ars: string;
	noRate: string;
}

export async function seedHandLedgers(): Promise<HandLedgers> {
	return {
		eur: await seedUser("EUR", BA, EUR_ROWS),
		eurUtc: await seedUser("EUR", "UTC", EUR_ROWS),
		ars: await seedUser("ARS", BA, ARS_ROWS),
		noRate: await seedUser("XQZ", BA, NO_RATE_ROWS),
	};
}
