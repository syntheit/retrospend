/**
 * The closed-month rule of a category merge: a closed month routes a
 * category's rows by the links it closed with, so a merge that gives the
 * source's rows the target's route would change that month's figures. The
 * server reads the facts here; the decision is the domain's
 * (closedMonthClash). A merge is refused, never written into a closed month.
 */
import { closedMonthClash } from "@retrospend/domain/category-merge/plan";
import { CategoryMergeRefusal } from "@retrospend/domain/category-merge/refusals";
import {
	budgetMonthOf,
	isoDateIn,
	type MonthBoundary,
} from "@retrospend/domain/envelope/months";
import type { MonthKey } from "@retrospend/domain/envelope/types";
import { monthCloseSummarySchema } from "~/lib/schemas/envelope";
import { findPersonalBook } from "../envelope/inputs";
import type { MergeCtx, Tx } from "./holder";

/** The dates of everything the caller has filed under the category: rows, shared expenses and shares. */
async function sourceDates(tx: Tx, userId: string, sourceId: string) {
	const own = { participantType: "user" as const, participantId: userId };
	const [rows, shared, shares] = await Promise.all([
		tx.expense.findMany({
			where: { userId, categoryId: sourceId },
			select: { date: true },
		}),
		tx.sharedTransaction.findMany({
			where: { categoryId: sourceId },
			select: { date: true },
		}),
		tx.splitParticipant.findMany({
			where: { ...own, categoryId: sourceId },
			select: { transaction: { select: { date: true } } },
		}),
	]);
	const dates = [
		...rows.map((r) => r.date),
		...shared.map((r) => r.date),
		...shares.map((r) => r.transaction.date),
	];
	// A share with no pick of its own takes the category the person last picked
	// for its project or payer, so once the category has picks, those follow it.
	if (shares.length > 0) {
		const unpicked = await tx.splitParticipant.findMany({
			where: { ...own, categoryId: null },
			select: { transaction: { select: { date: true } } },
		});
		dates.push(...unpicked.map((r) => r.transaction.date));
	}
	return dates;
}

export async function assertNoClosedMonthChange(c: MergeCtx): Promise<void> {
	const book = await findPersonalBook(c.tx, c.userId);
	if (!book?.defaultEnvelopeId) return;
	const closes = await c.tx.monthClose.findMany({
		where: { bookId: book.id },
		select: { month: true, summary: true },
	});
	if (closes.length === 0) return;
	const periods: MonthBoundary[] = book.periods.map((p) => ({
		fromMonth: p.fromMonth,
		startDay: p.startDay,
	}));
	const sourceMonths = new Set<MonthKey>(
		(await sourceDates(c.tx, c.userId, c.sourceId)).map((d) =>
			budgetMonthOf(isoDateIn(d, book.timeZone), periods),
		),
	);
	const clash = closedMonthClash({
		sourceId: c.sourceId,
		targetId: c.targetId,
		defaultEnvelopeId: book.defaultEnvelopeId,
		envelopeIds: new Set(book.envelopes.map((e) => e.id)),
		links: new Map(
			book.envelopes.flatMap((e) =>
				e.categories.map((l) => [l.categoryId, e.id] as const),
			),
		),
		closed: closes.map((m) => {
			const links = monthCloseSummarySchema.parse(m.summary).links;
			return {
				month: m.month,
				links: links ? new Map(Object.entries(links)) : null,
			};
		}),
		sourceMonths,
	});
	if (clash !== null) throw new CategoryMergeRefusal("category_closed_month");
}
