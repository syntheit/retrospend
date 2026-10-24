/**
 * Hidden rows to review (budget SPEC §8.3, build plan 02 §6). The old budget
 * skipped expenses marked "Hide from reports"; the new one counts them (B6,
 * the cash left, so the budget always sees it). When a legacy user moves in,
 * the hidden rows of the book's first month are listed once, each to answer
 * Spending (count it everywhere) or Not spending (a transfer or a payment
 * that was never a cost). Until answered they count.
 *
 * The review needs no state of its own: a row is up for review while it is
 * still hidden spending in that month. Either answer takes it out of the
 * list, and the undo puts the hide back on exactly the rows named.
 */
import type {
	HiddenAnswer,
	HiddenRow,
	HiddenRowsOutput,
	ResolveHiddenResult,
} from "~/lib/schemas/envelope-migration";
import type { Prisma } from "~prisma";
import { budgetSpendingWhere } from "../spending";
import { addMonths } from "./calendar";
import { EnvelopeError } from "./errors";
import { monthStartInstant } from "./inputs";
import { forgetMonthViews } from "./month-read";
import { isoDateIn } from "./months";
import { toMinor } from "./units";

type Tx = Prisma.TransactionClient;

/** The migrated book and the first month's span, or null (no book, or not a migrated one). */
async function reviewSpan(tx: Tx, userId: string) {
	const book = await tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: {
			currency: true,
			startMonth: true,
			monthStartDay: true,
			timeZone: true,
			legacyMigratedAt: true,
		},
	});
	if (!book?.legacyMigratedAt) return null;
	return {
		currency: book.currency,
		timeZone: book.timeZone,
		range: {
			gte: monthStartInstant(
				book.startMonth,
				book.monthStartDay,
				book.timeZone,
			),
			lt: monthStartInstant(
				addMonths(book.startMonth, 1),
				book.monthStartDay,
				book.timeZone,
			),
		},
	};
}

/** The hidden spending of a migrated user's first budget month, oldest first. */
export async function hiddenRowsIn(
	tx: Tx,
	userId: string,
): Promise<HiddenRowsOutput> {
	const span = await reviewSpan(tx, userId);
	if (!span) return { currency: null, rows: [] };
	const found = await tx.expense.findMany({
		where: {
			...budgetSpendingWhere(userId),
			date: { gte: span.range.gte, lt: span.range.lt },
			excludeFromAnalytics: true,
		},
		orderBy: [{ date: "asc" }, { id: "asc" }],
		select: {
			id: true,
			title: true,
			amount: true,
			currency: true,
			date: true,
			categoryId: true,
		},
	});
	const rows: HiddenRow[] = found.map((r) => ({
		id: r.id,
		title: r.title,
		date: isoDateIn(r.date, span.timeZone),
		amount: {
			minor: toMinor(r.amount.toString(), r.currency),
			currency: r.currency,
		},
		categoryId: r.categoryId,
	}));
	return { currency: span.currency, rows };
}

/** How many rows wait, for Needs you (one cheap count). */
export async function hiddenRowCount(tx: Tx, userId: string): Promise<number> {
	const span = await reviewSpan(tx, userId);
	if (!span) return 0;
	return tx.expense.count({
		where: {
			...budgetSpendingWhere(userId),
			date: { gte: span.range.gte, lt: span.range.lt },
			excludeFromAnalytics: true,
		},
	});
}

/**
 * Answers for rows still up for review. Spending shows the row in reports
 * (counted everywhere); Not spending takes it out of every spending total,
 * budget included, and keeps the hide so reports still skip it.
 */
export async function resolveHidden(
	tx: Tx,
	userId: string,
	answers: readonly { id: string; answer: HiddenAnswer }[],
): Promise<ResolveHiddenResult> {
	const ids = answers.map((a) => a.id);
	if (new Set(ids).size !== ids.length)
		throw new EnvelopeError("INVALID", "a row is answered once");
	const open = new Set((await hiddenRowsIn(tx, userId)).rows.map((r) => r.id));
	if (ids.some((id) => !open.has(id)))
		throw new EnvelopeError("NOT_FOUND", "that row is not up for review");
	const spending = answers
		.filter((a) => a.answer === "SPENDING")
		.map((a) => a.id);
	const transfers = answers
		.filter((a) => a.answer === "NOT_SPENDING")
		.map((a) => a.id);
	if (spending.length)
		await tx.expense.updateMany({
			where: { id: { in: spending } },
			data: { excludeFromAnalytics: false },
		});
	if (transfers.length)
		await tx.expense.updateMany({
			where: { id: { in: transfers } },
			data: { entryKind: "NOT_SPENDING" },
		});
	forgetMonthViews(tx);
	return { spending, notSpending: transfers };
}

/** The undo: the rows named go back to hidden spending, as the migration found them. */
export async function revertHidden(
	tx: Tx,
	userId: string,
	rows: { spending: readonly string[]; notSpending: readonly string[] },
): Promise<ResolveHiddenResult> {
	const all = [...rows.spending, ...rows.notSpending];
	// RLS shows only the user's own rows, so a count below the ids means foreign or missing ids.
	const own = await tx.expense.count({
		where: { id: { in: all }, userId, direction: "OUT" },
	});
	if (own !== new Set(all).size)
		throw new EnvelopeError("NOT_FOUND", "unknown row");
	await tx.expense.updateMany({
		where: { id: { in: all } },
		data: { entryKind: "STANDARD", excludeFromAnalytics: true },
	});
	forgetMonthViews(tx);
	return { spending: [...rows.spending], notSpending: [...rows.notSpending] };
}
