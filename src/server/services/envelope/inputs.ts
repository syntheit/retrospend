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
import { monthCloseSummarySchema } from "~/lib/schemas/envelope";
import type { Prisma, RecurringTemplate } from "~prisma";
import {
	budgetMoneyInWhere,
	budgetRefundWhere,
	budgetSpendingWhere,
} from "../spending";
import { addDays } from "./calendar";
import type { ClosedRule, EngineInput } from "./engine";
import {
	activityEntries,
	moneyInEntries,
	movementEntries,
	Valuer,
	wealthEntries,
} from "./entries";
import type { ViewBook, ViewEnvelope } from "./month-view";
import { budgetMonthOf, isoDateIn, type MonthBoundary } from "./months";
import { RateBook } from "./rate-book";
import { type LoadedSplits, loadSplits } from "./splits-input";
import { type TargetContext, targetOf } from "./target-input";
import type { IsoDate, MissingRate, MonthKey } from "./types";
import type { ValuationContext } from "./valuation";

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

const NOT_INCOME_CATEGORY = {
	NOT: { category: { is: { kind: "INCOME" as const } } },
};

export interface LoadedBook {
	row: BookRow;
	book: ViewBook;
	input: EngineInput;
	today: IsoDate;
	missingRates: MissingRate[];
	splits: LoadedSplits;
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
	const wealth = await tx.wealthTransfer.findMany({
		where: { bookId: row.id },
		select: {
			id: true,
			direction: true,
			envelopeId: true,
			date: true,
			amount: true,
		},
	});
	const closes = await tx.monthClose.findMany({
		where: { bookId: row.id },
		select: { month: true, summary: true },
	});
	const movements = await tx.budgetMovement.groupBy({
		by: ["month", "fromEnvelopeId", "toEnvelopeId"],
		where: { bookId: row.id },
		_sum: { amount: true },
	});
	return { moneyIn, spending, refunds, movements, wealth, closes };
}

function viewEnvelopes(row: BookRow, ctx: TargetContext): ViewEnvelope[] {
	return [...row.envelopes]
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
			...targetOf(e, ctx),
		}));
}

function viewBook(
	row: BookRow,
	defaultEnvelopeId: string,
	envelopes: ViewEnvelope[],
): ViewBook {
	return {
		id: row.id,
		style: row.style,
		fundingSource: row.fundingSource,
		currency: row.currency,
		startMonth: row.startMonth,
		weekStartDay: row.weekStartDay,
		periods: periodsOf(row),
		defaultEnvelopeId,
		groups: row.groups.map((g) => ({
			id: g.id,
			name: g.name,
			role: g.role,
			order: g.sortOrder,
		})),
		envelopes,
	};
}

/** Rates for the book currency and every other currency a target or template needs. */
function loadRates(
	tx: Tx,
	row: BookRow,
	templates: readonly RecurringTemplate[],
) {
	return RateBook.load(tx, {
		bookCurrency: row.currency,
		rateTypes: [
			...new Set(["official", ...row.periods.map((p) => p.rateType)]),
		],
		since: addDays(isoDateIn(row.startDate, row.timeZone), -31),
		extraCurrencies: [
			...row.envelopes.flatMap((e) =>
				e.targetCurrency ? [e.targetCurrency] : [],
			),
			...templates.map((t) => t.currency),
		],
	});
}

/** Loads and values every engine input of the user's personal book, or null without one. */
export async function loadBook(
	tx: Tx,
	userId: string,
	ctx: LoadContext,
): Promise<LoadedBook | null> {
	const row = await findPersonalBook(tx, userId);
	if (!row?.defaultEnvelopeId) return null;
	const periods = periodsOf(row);
	const today = isoDateIn(ctx.now, row.timeZone);
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
	const rates = await loadRates(tx, row, templates);
	const valuation: ValuationContext = {
		bookCurrency: row.currency,
		periods: row.periods.map((p) => ({
			fromMonth: p.fromMonth,
			startDay: p.startDay,
			rateType: p.rateType,
		})),
		defaultRateType: row.periods[0]?.rateType ?? "official",
		usdRate: rates.lookup,
	};
	const valuer = new Valuer(valuation, row.timeZone, periods);
	const splits = await loadSplits(tx, userId, valuer, row.startMonth);
	const wealth = wealthEntries(rows.wealth, valuer, row.currency);
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
		moneyIn: [...moneyInEntries(rows.moneyIn, valuer), ...wealth.moneyIn],
		activity: [
			...activityEntries(
				{ ...rows, shares: splits.shares, shareRate: splits.shareRate },
				valuer,
				splits.routing,
			),
			...wealth.activity,
		],
		movements: movementEntries(rows.movements, row.currency),
		splits: splits.replay.effects,
		closedRules: closedRulesOf(rows.closes),
	};
	const envelopes = viewEnvelopes(row, {
		valuation,
		today,
		month: currentMonth,
		tz: row.timeZone,
		periods,
		templates: new Map(templates.map((t) => [t.id, t])),
		missingRates: valuer.missingRates,
	});
	return {
		row,
		book: viewBook(row, row.defaultEnvelopeId, envelopes),
		input,
		today,
		missingRates: valuer.missingRates,
		splits,
	};
}

/** The leftover rules each closed month closed under (MonthClose snapshots, B7). */
function closedRulesOf(
	closes: ReadonlyArray<{ month: number; summary: Prisma.JsonValue }>,
): Map<MonthKey, Map<string, ClosedRule>> {
	const out = new Map<MonthKey, Map<string, ClosedRule>>();
	for (const c of closes) {
		const summary = monthCloseSummarySchema.parse(c.summary);
		out.set(
			c.month,
			new Map(
				summary.envelopes.map((e) => [
					e.id,
					{ rule: e.rule, sweepToId: e.sweepToId },
				]),
			),
		);
	}
	return out;
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
