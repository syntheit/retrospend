/**
 * Book periods (SPEC §5.1, C20, B9, D43, D44): the month start day and the
 * rate type foreign rows are valued at. A change applies from the next month
 * boundary that has not started yet, so no closed month and not the current
 * month's start ever move; the month that straddles a start-day change is
 * longer or shorter. Months are keyed by the calendar month their start day
 * falls in, so moving the 1st to the 25th mid-November starts the month of
 * Dec 25 and November runs to Dec 24.
 *
 * Writing a change again replaces a pending one; a change that puts back
 * what was in force removes the pending row instead (that is the undo).
 */

import { USD } from "~/lib/money";
import type {
	BookPeriodResult,
	SetBookPeriodInput,
} from "~/lib/schemas/envelope-book";
import type { Prisma } from "~prisma";
import { addMonths, daysBetween } from "./calendar";
import { EnvelopeError } from "./errors";
import { findPersonalBook } from "./inputs";
import { forgetMonthViews } from "./month-read";
import {
	budgetMonthOf,
	isoDateIn,
	type MonthBoundary,
	monthRange,
	monthStart,
} from "./months";
import { lockBook } from "./movement-state";
import { periodForMonth } from "./valuation";

type Tx = Prisma.TransactionClient;

interface Period {
	fromMonth: number;
	startDay: number;
	rateType: string;
}

/** The first month after `current` whose start under `next` is after today. */
export function firstFreeMonth(
	current: number,
	today: string,
	settled: readonly Period[],
	startDay: number,
): number {
	for (let k = addMonths(current, 1); ; k = addMonths(k, 1)) {
		const trial = [...settled, { fromMonth: k, startDay, rateType: "" }];
		if (monthStart(k, trial) > today) return k;
	}
}

/** The month before the change: its dates and length under the new periods. */
function transitionOf(month: number, periods: readonly MonthBoundary[]) {
	const range = monthRange(month, periods);
	return { key: month, ...range, days: daysBetween(range.from, range.to) + 1 };
}

async function checkRateType(tx: Tx, currency: string, rateType: string) {
	if (currency === USD) return;
	const any = await tx.exchangeRate.findFirst({
		where: { currency, type: rateType },
		select: { id: true },
	});
	if (!any)
		throw new EnvelopeError(
			"INVALID",
			`there are no ${rateType} rates for ${currency}`,
		);
}

export async function setBookPeriod(
	tx: Tx,
	userId: string,
	input: SetBookPeriodInput,
	now: Date,
): Promise<BookPeriodResult> {
	const book = await findPersonalBook(tx, userId);
	if (!book?.defaultEnvelopeId)
		throw new EnvelopeError("NO_BOOK", "start a budget first");
	await lockBook(tx, book.id);
	const today = isoDateIn(now, book.timeZone);
	const current = budgetMonthOf(today, book.periods);
	// Pending rows (from a month not started yet) are replaced, never stacked.
	const settled = book.periods.filter((p) => p.fromMonth <= current);
	const inForce = periodForMonth(addMonths(current, 1), settled);
	if (!inForce) throw new EnvelopeError("INVALID", "the book has no period");
	const startDay = input.startDay ?? inForce.startDay;
	const rateType = input.rateType ?? inForce.rateType;
	if (input.rateType) await checkRateType(tx, book.currency, rateType);
	const fromMonth = firstFreeMonth(current, today, settled, startDay);
	await tx.bookPeriod.deleteMany({
		where: { bookId: book.id, fromMonth: { gt: current } },
	});
	const same = startDay === inForce.startDay && rateType === inForce.rateType;
	const row = same
		? null
		: await tx.bookPeriod.create({
				data: { bookId: book.id, fromMonth, startDay, rateType },
				select: { id: true },
			});
	forgetMonthViews(tx);
	const after = same
		? settled
		: [...settled, { fromMonth, startDay, rateType }];
	return {
		periodId: row?.id ?? null,
		fromMonth,
		startsOn: monthStart(fromMonth, after),
		startDay,
		rateType,
		previous: { startDay: inForce.startDay, rateType: inForce.rateType },
		currentMonth: { key: current, ...monthRange(current, after) },
		transition: transitionOf(addMonths(fromMonth, -1), after),
	};
}
