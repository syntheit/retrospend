/**
 * Legacy budget to Limits, applied (budget build plan 02 §6). One function,
 * two entry points: `scripts/migrate-to-envelopes.ts` (batch, dry run by
 * default) and `ensureLegacyBook` (lazy, the first budget read of a person
 * with old limits and no book). Both run `migrateLegacyBudget` inside the
 * caller's per-user transaction; a dry run rolls that transaction back, so
 * its report is exactly what an apply would have written.
 *
 * Safe to repeat: a person with a personal book is left alone, so a second
 * run, a lazy read after the script and two lazy reads at once change
 * nothing (an advisory lock lines the last two up). The old `budget` rows are
 * never touched. Old history is dropped on purpose (owner, 02 §9.1 Q4).
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "~prisma";
import { userTimeZone } from "../user-time-zone";
import { rateTypeFor, setupBook } from "./book.service";
import { addMonths } from "./calendar";
import { computeBook } from "./engine";
import { hiddenRowsIn } from "./hidden-rows";
import { loadBook, monthStartInstant } from "./inputs";
import { invariantSides } from "./invariant";
import {
	type LegacyBudgetRow,
	type LegacyPlan,
	type LegacyRefusal,
	planLegacyMigration,
} from "./legacy-plan";
import { spendingByCategory } from "./limits.service";
import { forgetMonthViews, monthViewIn } from "./month-read";
import { budgetMonthOf, isoDateIn } from "./months";
import { RateBook } from "./rate-book";
import type { Minor, MonthKey } from "./types";
import { fromMinor, toMinor } from "./units";
import { convertToBook, type ValuationContext } from "./valuation";

type Tx = Prisma.TransactionClient;

export type MigrationStatus =
	| "MIGRATED"
	| "HAS_BOOK"
	| "NO_BUDGETS"
	| "NOTHING_TO_MIGRATE"
	| "MISSING_RATE"
	/** The batch runner only: this person's transaction failed and rolled back. */
	| "ERROR";

export interface MigrationReport {
	userId: string;
	status: MigrationStatus;
	currency: string | null;
	/** The legacy month the structure came from (YYYYMM), and whether it is an earlier one. */
	sourceMonth: MonthKey | null;
	sourceIsEarlier: boolean;
	envelopes: number;
	fixed: number;
	pegToActual: number;
	pegToLastMonth: number;
	global: boolean;
	/** The old total and what the new month funds, home currency minor units. */
	beforeMinor: Minor | null;
	fundedMinor: Minor | null;
	/** Currencies with no rate: the person was not migrated. */
	missingRates: string[];
	/** Budgets left out, with the reason. */
	left: { categoryId: string | null; reason: string }[];
	hiddenRows: number;
	/** The month opens funded: the plan funding batch exists and the engine's invariant holds. */
	funded: boolean;
	invariantOk: boolean | null;
	warnings: string[];
}

export interface MigrateContext {
	now: Date;
	/** The request's zone (lazy); null in the script, which falls back to the stored one and leaves it unconfirmed. */
	timeZone: string | null;
	runId: string;
}

export const emptyReport = (
	userId: string,
	status: MigrationStatus,
): MigrationReport => ({
	userId,
	status,
	currency: null,
	sourceMonth: null,
	sourceIsEarlier: false,
	envelopes: 0,
	fixed: 0,
	pegToActual: 0,
	pegToLastMonth: 0,
	global: false,
	beforeMinor: null,
	fundedMinor: null,
	missingRates: [],
	left: [],
	hiddenRows: 0,
	funded: false,
	invariantOk: null,
	warnings: [],
});

/**
 * The month a legacy `period` stands for. It was written as midnight on the
 * 1st in the server's own zone, so as an instant it can fall on the last day
 * of the month before (east of UTC); 15 days later is mid-month in any zone
 * and the process zone never matters.
 */
export function monthOfPeriod(period: Date): MonthKey {
	const mid = new Date(period.getTime() + 15 * 86_400_000);
	return mid.getUTCFullYear() * 100 + mid.getUTCMonth() + 1;
}

/** The source month: this one if it has rows, else the latest before it, else the latest there is. */
function sourceMonthOf(months: readonly MonthKey[], current: MonthKey) {
	const sorted = [...new Set(months)].sort((a, b) => a - b);
	if (sorted.includes(current)) return current;
	const before = sorted.filter((m) => m < current);
	return before.at(-1) ?? sorted.at(-1) ?? current;
}

interface Loaded {
	currency: string;
	startDay: number;
	zone: string;
	today: string;
	current: MonthKey;
	sourceMonth: MonthKey;
	budgets: LegacyBudgetRow[];
	rateType: string;
}

async function load(
	tx: Tx,
	userId: string,
	ctx: MigrateContext,
): Promise<Loaded | null> {
	const rows = await tx.budget.findMany({
		where: { userId },
		orderBy: [{ period: "desc" }, { createdAt: "asc" }],
	});
	if (rows.length === 0) return null;
	const user = await tx.user.findUniqueOrThrow({
		where: { id: userId },
		select: { homeCurrency: true, fiscalMonthStartDay: true },
	});
	const startDay = Math.min(28, Math.max(1, user.fiscalMonthStartDay));
	const zone = await userTimeZone(tx, userId, ctx.timeZone ?? undefined);
	const today = isoDateIn(ctx.now, zone);
	const current = budgetMonthOf(today, [{ fromMonth: 0, startDay }]);
	const withMonth = rows.map((r) => ({ r, month: monthOfPeriod(r.period) }));
	const sourceMonth = sourceMonthOf(
		withMonth.map((x) => x.month),
		current,
	);
	return {
		currency: user.homeCurrency,
		startDay,
		zone,
		today,
		current,
		sourceMonth,
		rateType: await rateTypeFor(tx, userId, user.homeCurrency),
		budgets: withMonth
			.filter((x) => x.month === sourceMonth)
			.map(({ r }) => ({
				categoryId: r.categoryId,
				amount: r.amount.toString(),
				currency: r.currency,
				type: r.type,
				pegToActual: r.pegToActual,
				isRollover: r.isRollover,
				rolloverAmount: r.rolloverAmount.toString(),
			})),
	};
}

/** The converter the plan sizes funding with: today's rates, the book's rate type, official for a third currency (D25). */
async function converter(tx: Tx, l: Loaded, currencies: readonly string[]) {
	const first = `${Math.floor(addMonths(l.current, -1) / 100)}-${String(addMonths(l.current, -1) % 100).padStart(2, "0")}-01`;
	const rates = await RateBook.load(tx, {
		bookCurrency: l.currency,
		rateTypes: [l.rateType, "official"],
		since: first,
		extraCurrencies: currencies,
	});
	const ctx: ValuationContext = {
		bookCurrency: l.currency,
		periods: [
			{ fromMonth: l.current, startDay: l.startDay, rateType: l.rateType },
		],
		defaultRateType: l.rateType,
		usdRate: rates.lookup,
	};
	return (amount: string, currency: string): Minor | null => {
		if (currency === l.currency) return toMinor(amount, currency);
		const v = convertToBook(
			amount,
			currency,
			{ date: l.today, month: l.current, foreignRateType: "official" },
			ctx,
		);
		return v.ok ? v.minor : null;
	};
}

/** Spending so far this month and last month, for the budgets that read it. */
async function spendingFor(tx: Tx, userId: string, l: Loaded) {
	const next = addMonths(l.current, 1);
	const last = addMonths(l.current, -1);
	const at = (m: MonthKey) => monthStartInstant(m, l.startDay, l.zone);
	const opts = { userId, uncategorized: true };
	const now = await spendingByCategory(
		tx,
		l.currency,
		l.rateType,
		{ gte: at(l.current), lte: new Date(at(next).getTime() - 1) },
		opts,
	);
	const before = await spendingByCategory(
		tx,
		l.currency,
		l.rateType,
		{ gte: at(last), lte: new Date(at(l.current).getTime() - 1) },
		opts,
	);
	return {
		spentNow: now.spent,
		spentLast: before.spent,
		missing: [...now.missingRates, ...before.missingRates].map(
			(m) => m.currency,
		),
	};
}

async function plan(tx: Tx, userId: string, l: Loaded) {
	const pegs = l.budgets.some((b) => b.type !== "FIXED" || b.pegToActual);
	const spending = pegs
		? await spendingFor(tx, userId, l)
		: { spentNow: new Map(), spentLast: new Map(), missing: [] as string[] };
	const categories = await tx.category.findMany({
		where: { userId, kind: "EXPENSE" },
		orderBy: [{ name: "asc" }, { id: "asc" }],
		select: { id: true, name: true, icon: true, color: true, isFixed: true },
	});
	const currencies = [...new Set(l.budgets.map((b) => b.currency))];
	return planLegacyMigration({
		currency: l.currency,
		budgets: l.budgets,
		categories,
		convert: await converter(tx, l, currencies),
		spentNow: spending.spentNow,
		spentLast: spending.spentLast,
		spendingMissing: spending.missing,
	});
}

/**
 * What the pegged envelopes and old rollovers still need after the book
 * exists. A pegged budget is funded with the activity the engine itself
 * counts (so Left is exactly 0 and the figure matches the Activity column);
 * an old rollover adds to the first plan funding.
 */
async function topUp(
	tx: Tx,
	userId: string,
	bookId: string,
	planned: LegacyPlan,
	now: Date,
) {
	const ids = await tx.envelope.findMany({
		where: { bookId },
		orderBy: { sortOrder: "asc" },
		select: { id: true },
	});
	forgetMonthViews(tx);
	const view = await monthViewIn(tx, userId, now);
	if (!view) throw new Error("the migrated book has no month view");
	const H = view.dto.book.currency;
	const left = new Map(
		view.dto.groups
			.flatMap((g) => g.envelopes)
			.map((e) => [e.id, e.left.minor]),
	);
	const batchId = randomUUID();
	const rows = planned.envelopes.flatMap((p, i) => {
		const id = ids[i]?.id as string;
		const minor =
			(p.pegged ? Math.max(0, -(left.get(id) ?? 0)) : 0) + p.rolloverMinor;
		return minor > 0
			? [
					{
						id: randomUUID(),
						bookId,
						month: view.dto.month.key,
						fromEnvelopeId: null,
						toEnvelopeId: id,
						amount: fromMinor(minor, H).toString(),
						kind: "PLAN_FUND" as const,
						batchId,
						actorUserId: userId,
					},
				]
			: [];
	});
	if (rows.length > 0) await tx.budgetMovement.createMany({ data: rows });
	for (const [i, p] of planned.envelopes.entries()) {
		if (!p.color) continue;
		await tx.envelope.update({
			where: { id: ids[i]?.id as string },
			data: { color: p.color as Prisma.EnvelopeUpdateInput["color"] },
		});
	}
	forgetMonthViews(tx);
}

/** What the book funds this month and whether the engine's invariant holds. */
async function verify(tx: Tx, userId: string, bookId: string, now: Date) {
	forgetMonthViews(tx);
	const loaded = await loadBook(tx, userId, { now, needFrom: 0 });
	if (!loaded) return { fundedMinor: 0, funded: false, invariantOk: false };
	const month = loaded.input.currentMonth;
	const funding = await tx.budgetMovement.findMany({
		where: { bookId, month, kind: "PLAN_FUND" },
		select: { amount: true },
	});
	const H = loaded.row.currency;
	const fundedMinor = funding.reduce(
		(t, m) => t + toMinor(m.amount.toString(), H),
		0,
	);
	const sides = invariantSides(loaded.input, computeBook(loaded.input));
	return {
		fundedMinor,
		funded: funding.length > 0,
		invariantOk: sides.budget === sides.ledger,
	};
}

function refused(
	base: MigrationReport,
	refusal: LegacyRefusal,
): MigrationReport {
	if (refusal.reason === "MISSING_RATE")
		return {
			...base,
			status: "MISSING_RATE",
			missingRates: refusal.currencies,
		};
	return { ...base, status: "NOTHING_TO_MIGRATE" };
}

/**
 * Moves one person's legacy budgets into a Limits book, on the caller's
 * per-user transaction (RLS set). Writes nothing for a person who already
 * has a book, has no budgets, has nothing worth moving, or needs a rate
 * there is none of.
 */
export async function migrateLegacyBudget(
	tx: Tx,
	userId: string,
	ctx: MigrateContext,
): Promise<MigrationReport> {
	// Two first reads at once, or the script beside a read, take turns.
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legacy_migration:${userId}`}))`;
	const book = await tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: { id: true },
	});
	if (book) return emptyReport(userId, "HAS_BOOK");
	const l = await load(tx, userId, ctx);
	if (!l) return emptyReport(userId, "NO_BUDGETS");
	const base = {
		...emptyReport(userId, "MIGRATED"),
		currency: l.currency,
		sourceMonth: l.sourceMonth,
		sourceIsEarlier: l.sourceMonth !== l.current,
	};
	const result = await plan(tx, userId, l);
	if (!result.ok) return refused(base, result.refusal);
	const made = await setupBook(tx, userId, result.plan.setup, {
		now: ctx.now,
		timeZone: ctx.timeZone,
	});
	await topUp(tx, userId, made.bookId, result.plan, ctx.now);
	await tx.budgetBook.update({
		where: { id: made.bookId },
		data: { legacyMigrationRunId: ctx.runId, legacyMigratedAt: ctx.now },
	});
	// The review only answers these rows, and a rollback hides them again.
	const hidden = (await hiddenRowsIn(tx, userId)).rows.map((row) => row.id);
	if (hidden.length > 0)
		await tx.budgetBook.update({
			where: { id: made.bookId },
			data: { legacyHiddenIds: hidden },
		});
	const check = await verify(tx, userId, made.bookId, ctx.now);
	const r = result.plan.report;
	const warnings: string[] = [];
	if (!check.invariantOk) warnings.push("the budget invariant does not hold");
	if (check.fundedMinor !== r.plannedMinor)
		warnings.push(
			`funded ${check.fundedMinor} but the plan said ${r.plannedMinor}`,
		);
	return {
		...base,
		envelopes: result.plan.envelopes.length,
		fixed: r.fixed,
		pegToActual: r.pegToActual,
		pegToLastMonth: r.pegToLastMonth,
		global: r.global,
		beforeMinor: r.beforeMinor,
		fundedMinor: check.fundedMinor,
		left: r.left,
		hiddenRows: hidden.length,
		funded: check.funded,
		invariantOk: check.invariantOk,
		warnings,
	};
}
