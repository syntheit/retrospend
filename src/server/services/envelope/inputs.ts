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
 *
 * With a valid checkpoint (checkpoint.ts, SPEC §5.13) own rows and
 * movements are read only after it; shares, payments and Wealth moves are
 * always read in full, since the splits replay needs every debt from its
 * start and their fingerprint is what keeps the checkpoint honest.
 */
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import type { Prisma, RecurringTemplate } from "~prisma";
import {
	budgetMoneyInWhere,
	budgetRefundWhere,
	budgetSpendingWhere,
} from "../spending";
import { addDays, addMonths } from "./calendar";
import {
	fingerprints,
	type StoredCheckpoint,
	toEngineCheckpoint,
} from "./checkpoint";
import {
	type CloseRow,
	type DirtyMark,
	loadCloseRows,
	loadDirtyMarks,
	pickCheckpoint,
} from "./close-rows";
import type { ClosedRule, EngineInput } from "./engine";
import {
	activityEntries,
	moneyInEntries,
	movementEntries,
	Valuer,
	wealthEntries,
} from "./entries";
import type { ViewBook, ViewEnvelope } from "./month-view";
import {
	budgetMonthOf,
	isoDateIn,
	type MonthBoundary,
	monthStart,
	monthsFrom,
} from "./months";
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
	/** Every close of the book, oldest first. */
	closes: CloseRow[];
	/** budget_dirty marks seen by this load. */
	dirty: DirtyMark[];
	/** The checkpoint the pass starts at, or null for a pass from the start. */
	checkpoint: StoredCheckpoint | null;
	/** Fingerprints of the fully loaded rows per month up to last month (checkpoint.ts). */
	prints: ReadonlyMap<MonthKey, string>;
	periods: MonthBoundary[];
}

export interface LoadContext {
	now: Date;
	/**
	 * The first month the caller reads (default: last month, which carry an
	 * overspend and the close need). Older months are not computed.
	 */
	needFrom?: MonthKey;
}

function periodsOf(row: BookRow): MonthBoundary[] {
	return row.periods.map((p) => ({
		fromMonth: p.fromMonth,
		startDay: p.startDay,
	}));
}

/** Two days of slack: the month mapping in the book zone decides. */
const SLACK_MS = 2 * 86_400_000;

/** Own rows from `from` on and movements after `afterMonth` (the checkpoint). */
async function loadOwnRows(
	tx: Tx,
	row: BookRow,
	userId: string,
	from: Date,
	afterMonth: MonthKey,
) {
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
	const movements = await tx.budgetMovement.groupBy({
		by: ["month", "fromEnvelopeId", "toEnvelopeId"],
		where: { bookId: row.id, month: { gt: afterMonth } },
		_sum: { amount: true },
	});
	return { moneyIn, spending, refunds, movements };
}

/** Every Wealth move of the book: goal progress needs them all, and they are few. */
function loadWealthRows(tx: Tx, bookId: string) {
	return tx.wealthTransfer.findMany({
		where: { bookId },
		select: {
			id: true,
			direction: true,
			envelopeId: true,
			date: true,
			amount: true,
		},
	});
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
	const s = await settingOf(tx, row, ctx.now);
	const closes = await loadCloseRows(tx, row.id);
	const dirty = await loadDirtyMarks(tx, row.id);
	const full = await loadFull(tx, userId, s);
	const lastClosed = addMonths(s.currentMonth, -1);
	const prints =
		lastClosed >= row.startMonth
			? fingerprints(full.entries, monthsFrom(row.startMonth, lastClosed))
			: new Map<MonthKey, string>();
	const checkpoint = pickCheckpoint(closes, {
		needFrom: ctx.needFrom ?? lastClosed,
		currentMonth: s.currentMonth,
		dirty,
		prints,
	});
	const after = checkpoint?.month ?? addMonths(row.startMonth, -1);
	const fromDay = monthStart(addMonths(after, 1), s.periods);
	const from = new Date(
		Math.max(
			new Date(`${fromDay}T00:00:00Z`).getTime(),
			row.startDate.getTime(),
		) - SLACK_MS,
	);
	const own = await loadOwnRows(tx, row, userId, from, after);
	const input: EngineInput = {
		startMonth: row.startMonth,
		currentMonth: s.currentMonth,
		defaultEnvelopeId: row.defaultEnvelopeId,
		envelopes: row.envelopes.map((e) => ({
			id: e.id,
			kind: e.kind,
			leftoverRule: e.leftoverRule,
			sweepToId: e.leftoverSweepToId,
			categoryIds: e.categories.map((c) => c.categoryId),
		})),
		moneyIn: [...moneyInEntries(own.moneyIn, s.valuer), ...full.entries.moneyIn],
		activity: [
			...activityEntries(
				{ ...own, shares: [], shareRate: full.splits.shareRate },
				s.valuer,
				full.splits.routing,
			),
			...full.entries.activity,
		],
		movements: movementEntries(own.movements, row.currency),
		splits: full.entries.splits,
		closedRules: closedRulesOf(closes),
		checkpoint: checkpoint ? toEngineCheckpoint(checkpoint) : null,
	};
	return finishLoad(s, {
		input,
		splits: full.splits,
		closes,
		dirty,
		checkpoint,
		prints,
	});
}

interface Setting {
	row: BookRow;
	periods: MonthBoundary[];
	today: IsoDate;
	currentMonth: MonthKey;
	valuation: ValuationContext;
	valuer: Valuer;
	templates: RecurringTemplate[];
}

async function settingOf(tx: Tx, row: BookRow, now: Date): Promise<Setting> {
	const periods = periodsOf(row);
	const today = isoDateIn(now, row.timeZone);
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
	return {
		row,
		periods,
		today,
		currentMonth: budgetMonthOf(today, periods),
		valuation,
		valuer: new Valuer(valuation, row.timeZone, periods),
		templates,
	};
}

/** Shares, payments and Wealth moves, read in full on every load. */
async function loadFull(tx: Tx, userId: string, s: Setting) {
	const splits = await loadSplits(tx, userId, s.valuer, s.row.startMonth);
	const wealth = wealthEntries(
		await loadWealthRows(tx, s.row.id),
		s.valuer,
		s.row.currency,
	);
	const shares = activityEntries(
		{
			spending: [],
			refunds: [],
			shares: splits.shares,
			shareRate: splits.shareRate,
		},
		s.valuer,
		splits.routing,
	);
	return {
		splits,
		entries: {
			activity: [...shares, ...wealth.activity],
			moneyIn: wealth.moneyIn,
			splits: splits.replay.effects,
		},
	};
}

/** Same rate, same row: listed once (a checkpoint and the full share load can both name it). */
function uniqueMissing(rates: readonly MissingRate[]): MissingRate[] {
	const seen = new Map<string, MissingRate>();
	for (const r of rates)
		seen.set(`${r.rowId ?? ""}|${r.currency}|${r.rateType}|${r.date}`, r);
	return [...seen.values()];
}

function finishLoad(
	s: Setting,
	p: Pick<
		LoadedBook,
		"input" | "splits" | "closes" | "dirty" | "checkpoint" | "prints"
	>,
): LoadedBook {
	const envelopes = viewEnvelopes(s.row, {
		valuation: s.valuation,
		today: s.today,
		month: s.currentMonth,
		tz: s.row.timeZone,
		periods: s.periods,
		templates: new Map(s.templates.map((t) => [t.id, t])),
		missingRates: s.valuer.missingRates,
	});
	return {
		...p,
		row: s.row,
		book: viewBook(s.row, p.input.defaultEnvelopeId, envelopes),
		today: s.today,
		missingRates: uniqueMissing([
			...(p.checkpoint?.missingRates ?? []),
			...s.valuer.missingRates,
		]),
		periods: s.periods,
	};
}

/** The leftover rules each closed month closed under (MonthClose snapshots, B7). */
function closedRulesOf(
	closes: readonly CloseRow[],
): Map<MonthKey, Map<string, ClosedRule>> {
	const out = new Map<MonthKey, Map<string, ClosedRule>>();
	for (const c of closes)
		out.set(
			c.month,
			new Map(
				c.summary.envelopes.map((e) => [
					e.id,
					{ rule: e.rule, sweepToId: e.sweepToId },
				]),
			),
		);
	return out;
}

/** Own missing rates of months up to `month`: what a checkpoint there carries. */
export function missingThrough(
	loaded: LoadedBook,
	month: MonthKey,
): MissingRate[] {
	return loaded.missingRates.filter(
		(r) => budgetMonthOf(r.date, loaded.periods) <= month,
	);
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
