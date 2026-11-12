/**
 * The pure half of the `spent` figure: your spending (personal rows that
 * count, plus your shares, minus refunds) as the groups a loader reads and the
 * per-currency minor units the figure shows. The server loads the groups with
 * SQL (server/services/figures/spent.ts); a device loads rows from its own
 * store and groups them here (spentInputsFromRows). Both feed the same compute,
 * and a pg test holds the two loaders to each other digit for digit.
 *
 * The row rules are the JS twins of the where clauses in
 * server/services/spending.ts (reports basis) and shared-expense-integration.ts.
 * Nothing here converts: a rate enters only through a share's USD value, which
 * the loader supplies, and a missing one stays NaN so sumIn names it.
 */
import { getCurrentFiscalMonth, getFiscalMonthRange } from "./fiscal-month";
import { type MoneyItem, toUSD, USD } from "./money";
import { type Money, roundedMinor, toMinor } from "./money-minor";
import { type Decimal, type DecimalInput, dec } from "./precise-decimal";

/** The sums of rows that share a currency and a booked home currency (rows booked when saved, M2, are split from the rest). */
export interface SpentGroup {
	currency: string;
	homeCurrency: string | null;
	categoryId?: string | null;
	date?: Date | null;
	amount: DecimalInput;
	amountInUSD: DecimalInput;
	homeAmount: DecimalInput;
	count: number;
}

/** A slice of spending. Refunds come as negative amounts, so a plain sum nets them. */
export interface SpentItem extends MoneyItem {
	categoryId: string | null;
	date: Date | null;
	/** Spending entries behind this item; a refund nets the amount but is not an expense, so it counts 0. */
	count: number;
}

/** Your share of a shared expense, with its USD value (NaN when its currency has no rate at all). */
export interface SpentShare {
	amount: number;
	/** The stored amount as exact decimal text; the minor units read it, so a huge share never goes through a float. */
	amountExact?: string;
	currency: string;
	amountInUSD: number;
	categoryId: string | null;
	date: Date;
}

/** Everything the figure reads: spending and refund groups per currency, and shares. */
export interface SpentInputs {
	spending: SpentGroup[];
	refunds: SpentGroup[];
	shares: SpentShare[];
}

/** An expense row as stored, the fields the spending rules read. */
export interface SpentExpenseRow {
	status: string;
	direction: string;
	entryKind: string;
	inType: string | null;
	isAmortizedParent: boolean;
	excludeFromAnalytics: boolean;
	/** The kind of its category, null for none. Income categories never count. */
	categoryKind: string | null;
	/** Only read when grouping per day (the spend pace), where it splits groups as the SQL loader's does. */
	categoryId?: string | null;
	date: Date;
	currency: string;
	amount: DecimalInput;
	amountInUSD: DecimalInput;
	homeCurrency: string | null;
	homeAmount: DecimalInput | null;
}

/** One of your split participations as stored, with its transaction's fields. */
export interface SpentShareRow {
	shareAmount: DecimalInput;
	verificationStatus: string;
	currency: string;
	date: Date;
	projectId: string | null;
	/** Rate captured when the expense was saved (units per USD), or null. */
	exchangeRate: DecimalInput | null;
	/** The share's category when it is yours, else null. */
	categoryId: string | null;
}

export interface SpentRange {
	start: Date;
	end: Date;
}

const inRange = (d: Date, r: SpentRange) =>
	d.getTime() >= r.start.getTime() && d.getTime() <= r.end.getTime();

/** reportSpendingWhere, on a row. */
export function countsAsSpending(row: SpentExpenseRow, r: SpentRange): boolean {
	return (
		row.status === "FINALIZED" &&
		row.direction === "OUT" &&
		row.entryKind === "STANDARD" &&
		!row.isAmortizedParent &&
		!row.excludeFromAnalytics &&
		row.categoryKind !== "INCOME" &&
		inRange(row.date, r)
	);
}

/** reportRefundWhere, on a row: a refund nets in its own month. */
export function countsAsRefund(row: SpentExpenseRow, r: SpentRange): boolean {
	return (
		row.status === "FINALIZED" &&
		row.direction === "IN" &&
		row.entryKind === "STANDARD" &&
		row.inType === "REFUND" &&
		!row.excludeFromAnalytics &&
		row.categoryKind !== "INCOME" &&
		inRange(row.date, r)
	);
}

/** How rows are grouped: per currency, or per entry instant and category too (the SQL loader's "day" grouping). */
export type SpentRowGrouping = "currency" | "day";

/**
 * The income rule of Just track's "Money in" (services/figures/spend-pace.ts),
 * on a row: money in typed as income, outside Hide from reports. Refunds are
 * spending's, own transfers and adjustments are nothing.
 */
export function countsAsIncome(row: SpentExpenseRow, r: SpentRange): boolean {
	return (
		row.status === "FINALIZED" &&
		row.direction === "IN" &&
		row.entryKind === "STANDARD" &&
		row.inType === "INCOME" &&
		!row.excludeFromAnalytics &&
		inRange(row.date, r)
	);
}

/** The JS counterpart of the loader's grouped SUM: per currency and booked home currency, exact. */
export function groupSpentRows(
	rows: Iterable<SpentExpenseRow>,
	by: SpentRowGrouping = "currency",
): SpentGroup[] {
	const groups = new Map<
		string,
		{
			currency: string;
			homeCurrency: string | null;
			categoryId: string | null;
			date: Date | null;
			count: number;
			sums: Decimal[];
		}
	>();
	for (const r of rows) {
		const daily = by === "day";
		const categoryId = daily ? (r.categoryId ?? null) : null;
		const key = JSON.stringify([
			daily ? r.date.getTime() : null,
			categoryId,
			r.currency,
			r.homeCurrency,
		]);
		const g = groups.get(key) ?? {
			currency: r.currency,
			homeCurrency: r.homeCurrency,
			categoryId,
			date: daily ? r.date : null,
			count: 0,
			sums: [dec(0), dec(0), dec(0)],
		};
		const add = [r.amount, r.amountInUSD, r.homeAmount ?? 0];
		g.sums = g.sums.map((sum, i) => sum.plus(dec(add[i] as DecimalInput)));
		g.count += 1;
		groups.set(key, g);
	}
	return [...groups.values()].map((g) => ({
		currency: g.currency,
		homeCurrency: g.homeCurrency,
		categoryId: g.categoryId,
		date: g.date,
		amount: (g.sums[0] as Decimal).toFixed(),
		amountInUSD: (g.sums[1] as Decimal).toFixed(),
		homeAmount: (g.sums[2] as Decimal).toFixed(),
		count: g.count,
	}));
}

/** A share's rate as the server resolves it before the table: USD is 1, else the one captured when saved. Null when neither (the device looks it up in its rates). */
const capturedRate = (s: SpentShareRow): number | null =>
	s.currency === USD
		? 1
		: s.exchangeRate !== null
			? Number(s.exchangeRate.toString())
			: null;

/**
 * The figure's inputs from rows held in memory, in the range: what a device
 * loader returns. `hiddenProjectIds` are the projects hidden from reports;
 * `rateFor` prices a share (default: USD, else the captured rate; null leaves
 * it unpriced).
 */
export function spentInputsFromRows(args: {
	expenses: readonly SpentExpenseRow[];
	shares: readonly SpentShareRow[];
	hiddenProjectIds: readonly string[];
	range: SpentRange;
	rateFor?: (s: SpentShareRow) => number | null;
	/** "day" keeps each entry instant and category apart, for the readers that bucket by day. */
	by?: SpentRowGrouping;
}): SpentInputs {
	const { range } = args;
	const rateFor = args.rateFor ?? capturedRate;
	return {
		spending: groupSpentRows(
			args.expenses.filter((r) => countsAsSpending(r, range)),
			args.by,
		),
		refunds: groupSpentRows(
			args.expenses.filter((r) => countsAsRefund(r, range)),
			args.by,
		),
		shares: args.shares
			.filter(
				(s) =>
					s.verificationStatus !== "REJECTED" &&
					inRange(s.date, range) &&
					(s.projectId === null ||
						!args.hiddenProjectIds.includes(s.projectId)),
			)
			.map((s) => {
				const amount = Number(s.shareAmount.toString());
				const rate = rateFor(s);
				return {
					amount,
					amountExact: dec(s.shareAmount).toFixed(),
					currency: s.currency,
					amountInUSD:
						rate === null ? Number.NaN : toUSD(amount, s.currency, rate),
					categoryId: s.categoryId,
					date: s.date,
				};
			}),
	};
}

/** A group as an item to total with sumIn. */
export const spentItemOf =
	(sign: 1 | -1) =>
	(g: SpentGroup): SpentItem => ({
		currency: g.currency,
		amount: sign * Number(g.amount.toString()),
		amountInUSD: sign * Number(g.amountInUSD.toString()),
		booked: g.homeCurrency
			? {
					currency: g.homeCurrency,
					amount: sign * Number(g.homeAmount.toString()),
				}
			: null,
		categoryId: g.categoryId ?? null,
		date: g.date ?? null,
		count: sign === 1 ? g.count : 0,
	});

/** The inputs as items: spending, refunds as negatives, and shares. */
export function spentItemsOf(inputs: SpentInputs): SpentItem[] {
	return [
		...inputs.spending.map(spentItemOf(1)),
		...inputs.refunds.map(spentItemOf(-1)),
		...inputs.shares.map((s) => ({ ...s, count: 1 })),
	];
}

/**
 * Spending per original currency, in minor units and never converted (the
 * figure shape). Each group rounds on its own, as a legacy row's sum always
 * has; currencies that net to zero are dropped, so "nothing spent" reads the
 * same however it came about.
 */
export function spentMinorByCurrency(inputs: SpentInputs): Money[] {
	const minor = new Map<string, number>();
	const add = (currency: string, units: number) =>
		minor.set(currency, (minor.get(currency) ?? 0) + units);
	for (const g of inputs.spending)
		add(g.currency, roundedMinor(g.amount, g.currency));
	for (const g of inputs.refunds)
		add(g.currency, -roundedMinor(g.amount, g.currency));
	for (const s of inputs.shares)
		add(
			s.currency,
			s.amountExact === undefined
				? toMinor(s.amount, s.currency)
				: roundedMinor(s.amountExact, s.currency),
		);
	return [...minor]
		.filter(([, units]) => units !== 0)
		.map(([currency, units]) => ({ minor: units, currency }));
}

/**
 * The fiscal month the figure reads: the user's start day in their zone. A
 * figure read has no request, so the zone is the stored one, resolved by the
 * caller (the device passes its own).
 */
export function spentRange(
	now: Date,
	startDay: number,
	timeZone: string,
): SpentRange {
	return getFiscalMonthRange(
		getCurrentFiscalMonth(now, startDay, timeZone),
		startDay,
		timeZone,
	);
}
