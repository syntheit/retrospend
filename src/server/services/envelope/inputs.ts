/**
 * Loads one book's engine inputs (build plan 02 §5.3) through the caller's
 * transaction, so RLS applies and a preview sees its own uncommitted rows.
 * A fixed number of queries, whatever the history length: book with groups,
 * envelopes and links; movements grouped by month and sides; money in;
 * spending and refunds; shares; templates; rates.
 *
 * Every row is valued once in the book currency H (valuation.ts) and dated
 * by the calendar date the person saw in the book's zone (SPEC §5.1, C21).
 * A row without a rate is left out and listed (C18), never valued at 1.
 */
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { isCrypto } from "~/lib/currency-format";
import { USD } from "~/lib/money";
import type { Prisma } from "~prisma";
import { budgetRefundWhere, budgetSpendingWhere } from "../spending";
import { addDays } from "./calendar";
import type {
	ActivityEntry,
	EngineInput,
	MoneyInEntry,
	MovementEntry,
} from "./engine";
import type { ViewBook, ViewEnvelope } from "./month-view";
import { budgetMonthOf, isoDateIn, type MonthBoundary } from "./months";
import { RateBook } from "./rate-book";
import { targetOf } from "./target-input";
import type { IsoDate, MissingRate, MonthKey } from "./types";
import { dec, toMinor } from "./units";
import { type ValuationContext, valueRow } from "./valuation";

type Tx = Prisma.TransactionClient;

const BOOK_INCLUDE = {
	periods: true,
	groups: { where: { archivedAt: null } },
	envelopes: { include: { categories: { select: { categoryId: true } } } },
} as const;

export type BookRow = NonNullable<Awaited<ReturnType<typeof findPersonalBook>>>;

/** The user's personal book (one per user, D33), or null for "Just track". */
export function findPersonalBook(tx: Tx, userId: string) {
	return tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		include: BOOK_INCLUDE,
	});
}

/**
 * Money in the budget counts (SPEC §5.2, §12.3): income entering To assign,
 * the starting balance and adjustments. Refunds are envelope Activity, own
 * transfers (NOT_SPENDING) are nothing. The sibling of spending.ts's budget
 * filters; it moves there with the income service (2D).
 */
export function budgetMoneyInWhere(
	userId: string,
	from: Date,
): Prisma.ExpenseWhereInput {
	return {
		userId,
		status: "FINALIZED",
		date: { gte: from },
		OR: [
			{ direction: "IN", entryKind: "STANDARD", inType: "INCOME" },
			{ entryKind: { in: ["STARTING_BALANCE", "ADJUSTMENT"] } },
		],
	};
}

const NOT_INCOME_CATEGORY = {
	NOT: { category: { is: { kind: "INCOME" as const } } },
};

export interface LoadedBook {
	row: BookRow;
	book: ViewBook;
	input: EngineInput;
	today: IsoDate;
	missingRates: MissingRate[];
}

export interface LoadContext {
	now: Date;
}

function periodsOf(row: BookRow): MonthBoundary[] {
	return row.periods.map((p) => ({
		fromMonth: p.fromMonth,
		startDay: p.startDay,
	}));
}

async function loadRows(tx: Tx, row: BookRow, userId: string) {
	// Two days of slack around the start: the month mapping in the book zone decides.
	const from = new Date(row.startDate.getTime() - 2 * 86_400_000);
	const select = {
		id: true,
		amount: true,
		currency: true,
		amountInUSD: true,
		date: true,
		categoryId: true,
		recurringTemplateId: true,
		direction: true,
		entryKind: true,
	} as const;
	const moneyIn = await tx.expense.findMany({
		where: budgetMoneyInWhere(userId, from),
		select,
	});
	const spending = await tx.expense.findMany({
		where: {
			...budgetSpendingWhere(userId, { gte: from }),
			...NOT_INCOME_CATEGORY,
		},
		select,
	});
	const refunds = await tx.expense.findMany({
		where: {
			...budgetRefundWhere(userId, { gte: from }),
			...NOT_INCOME_CATEGORY,
		},
		select,
	});
	const shares = await tx.splitParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			verificationStatus: { not: "REJECTED" },
			transaction: { date: { gte: from } },
		},
		select: {
			id: true,
			shareAmount: true,
			verificationStatus: true,
			transaction: {
				select: {
					currency: true,
					date: true,
					categoryId: true,
					exchangeRate: true,
					category: { select: { userId: true } },
				},
			},
		},
	});
	const movements = await tx.budgetMovement.groupBy({
		by: ["month", "fromEnvelopeId", "toEnvelopeId"],
		where: { bookId: row.id },
		_sum: { amount: true },
	});
	return { moneyIn, spending, refunds, shares, movements };
}

/** The USD value of a share at the rate its expense captured, else the table rate (units per USD; crypto USD per coin). */
function shareUsd(
	amount: Prisma.Decimal,
	rate: string | null,
	currency: string,
) {
	if (currency === USD) return amount.toString();
	const r = rate ? dec(rate) : null;
	if (!r || r.lte(0)) return null;
	const a = dec(amount.toString());
	return (isCrypto(currency) ? a.mul(r) : a.div(r)).toString();
}

/** Loads and values every engine input of the user's personal book, or null without one. */
export async function loadBook(
	tx: Tx,
	userId: string,
	ctx: LoadContext,
): Promise<LoadedBook | null> {
	const row = await findPersonalBook(tx, userId);
	if (!row?.defaultEnvelopeId) return null;
	const H = row.currency;
	const tz = row.timeZone;
	const periods = periodsOf(row);
	const today = isoDateIn(ctx.now, tz);
	const currentMonth = budgetMonthOf(today, periods);
	const rows = await loadRows(tx, row, userId);
	const templateIds = row.envelopes.flatMap((e) =>
		e.targetTemplateId ? [e.targetTemplateId] : [],
	);
	const templates = templateIds.length
		? await tx.recurringTemplate.findMany({
				where: { id: { in: templateIds } },
			})
		: [];
	const rates = await RateBook.load(tx, {
		bookCurrency: H,
		rateTypes: [
			...new Set(["official", ...row.periods.map((p) => p.rateType)]),
		],
		since: addDays(isoDateIn(row.startDate, tz), -31),
		extraCurrencies: [
			...row.envelopes.flatMap((e) =>
				e.targetCurrency ? [e.targetCurrency] : [],
			),
			...templates.map((t) => t.currency),
			...rows.shares
				.filter((s) => !s.transaction.exchangeRate)
				.map((s) => s.transaction.currency),
		],
	});
	const valuation: ValuationContext = {
		bookCurrency: H,
		periods: row.periods.map((p) => ({
			fromMonth: p.fromMonth,
			startDay: p.startDay,
			rateType: p.rateType,
		})),
		defaultRateType: row.periods[0]?.rateType ?? "official",
		usdRate: rates.lookup,
	};
	const missingRates: MissingRate[] = [];
	const dated = (d: Date) => {
		const date = isoDateIn(d, tz);
		return { date, month: budgetMonthOf(date, periods) };
	};
	const value = (
		r: {
			id: string;
			amount: Prisma.Decimal;
			currency: string;
			amountInUSD: Prisma.Decimal | string | null;
		},
		date: IsoDate,
		month: MonthKey,
	) => {
		const v = valueRow(
			{
				id: r.id,
				amount: r.amount.toString(),
				currency: r.currency,
				date,
				month,
				amountInUSD: r.amountInUSD?.toString() ?? null,
			},
			valuation,
		);
		if (v.ok) return v.minor;
		missingRates.push(v.missing);
		return null;
	};

	const moneyIn: MoneyInEntry[] = [];
	for (const r of rows.moneyIn) {
		const { date, month } = dated(r.date);
		const minor = value(r, date, month);
		if (minor === null) continue;
		const source =
			r.entryKind === "STANDARD"
				? "INCOME"
				: r.entryKind === "STARTING_BALANCE"
					? "STARTING_BALANCE"
					: "ADJUSTMENT";
		moneyIn.push({
			id: r.id,
			month,
			minor: r.direction === "OUT" ? -minor : minor,
			source,
		});
	}

	const activity: ActivityEntry[] = [];
	const push = (
		r: (typeof rows.spending)[number],
		sign: 1 | -1,
		source: "SPENT" | "REFUND",
	) => {
		const { date, month } = dated(r.date);
		const minor = value(r, date, month);
		if (minor === null) return;
		activity.push({
			id: r.id,
			month,
			date,
			minor: sign * minor,
			source,
			categoryId: r.categoryId,
			recurring: r.recurringTemplateId !== null,
		});
	};
	for (const r of rows.spending) push(r, -1, "SPENT");
	for (const r of rows.refunds) push(r, 1, "REFUND");
	for (const s of rows.shares) {
		const t = s.transaction;
		const { date, month } = dated(t.date);
		const minor = value(
			{
				id: s.id,
				amount: s.shareAmount,
				currency: t.currency,
				amountInUSD: shareUsd(
					s.shareAmount,
					t.exchangeRate?.toString() ?? rates.anyRate(t.currency, date),
					t.currency,
				),
			},
			date,
			month,
		);
		if (minor === null) continue;
		activity.push({
			id: s.id,
			month,
			date,
			minor: -minor,
			source: "SHARE",
			// Today's rule (D19 lands in P3): the creator's category only counts when it is yours.
			categoryId: t.category?.userId === userId ? t.categoryId : null,
			pending: s.verificationStatus === "PENDING",
		});
	}

	const movements: MovementEntry[] = rows.movements.map((g) => ({
		id: `${g.month}:${g.fromEnvelopeId ?? "pool"}:${g.toEnvelopeId ?? "pool"}`,
		month: g.month,
		from: g.fromEnvelopeId,
		to: g.toEnvelopeId,
		minor: toMinor(g._sum.amount?.toString() ?? "0", H),
	}));

	const templateById = new Map(templates.map((t) => [t.id, t]));
	const targetCtx = {
		valuation,
		today,
		month: currentMonth,
		tz,
		periods,
		templates: templateById,
		missingRates,
	};
	const envelopes: ViewEnvelope[] = [...row.envelopes]
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((e) => ({
			id: e.id,
			name: e.name,
			icon: e.icon,
			color: e.color,
			kind: e.kind,
			groupId: e.groupId,
			order: e.sortOrder,
			categoryIds: e.categories.map((c) => c.categoryId),
			archived: e.archivedAt !== null,
			targetStartMonth: e.targetStartMonth,
			...targetOf(e, targetCtx),
		}));

	const book: ViewBook = {
		id: row.id,
		style: row.style,
		fundingSource: row.fundingSource,
		currency: H,
		startMonth: row.startMonth,
		weekStartDay: row.weekStartDay,
		periods,
		defaultEnvelopeId: row.defaultEnvelopeId,
		groups: row.groups.map((g) => ({
			id: g.id,
			name: g.name,
			role: g.role,
			order: g.sortOrder,
		})),
		envelopes,
	};
	const input: EngineInput = {
		startMonth: row.startMonth,
		currentMonth,
		defaultEnvelopeId: row.defaultEnvelopeId,
		envelopes: row.envelopes.map((e) => ({
			id: e.id,
			kind: e.kind,
			leftoverRule: e.leftoverRule,
			sweepToId: e.leftoverSweepToId,
			categoryIds: e.categories.map((c) => c.categoryId),
		})),
		moneyIn,
		activity,
		movements,
		splits: [],
	};
	return { row, book, input, today, missingRates };
}

/** Midnight at the start of budget month `month` in the book zone: the book's startDate. */
export function monthStartInstant(
	month: MonthKey,
	startDay: number,
	timeZone: string,
): Date {
	const y = Math.floor(month / 100);
	const mo = month % 100;
	return parseDateOnlyIn(
		`${y}-${String(mo).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
		timeZone,
	);
}
