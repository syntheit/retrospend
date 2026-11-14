/**
 * The month view of a source: the same figures on the server and on a
 * device. The server answers with Postgres (server/services/envelope/
 * month-read.ts), a device from its own store; the view itself never sees a
 * database.
 */
import type { BookRowCore, CloseRowCore, LoadedBook } from "./book-source";
import { addMonths } from "./calendar";
import { computeBook, type MoneyInEntry } from "./engine";
import { EnvelopeError } from "./errors";
import type { GroupBase } from "./group-view";
import { hasPercentGroup } from "./income-history";
import type { LoadContext } from "./load-book";
import { buildMonthView, type MonthView } from "./month-view";
import { owedSummary } from "./owed";
import { startingMoneyIn } from "./starting-money-in";
import type { MonthKey } from "./types";

export interface MonthRead<
	R extends BookRowCore = BookRowCore,
	C extends CloseRowCore = CloseRowCore,
> extends MonthView {
	loaded: LoadedBook<R, C>;
}

/** What a month view reads. */
export interface MonthViewSource<
	R extends BookRowCore = BookRowCore,
	C extends CloseRowCore = CloseRowCore,
> {
	loadBook(ctx: LoadContext): Promise<LoadedBook<R, C> | null>;
	/** The % base of a month for percent groups (SPEC §5.9), which needs closed months. */
	groupBase(
		loaded: LoadedBook<R, C>,
		month: MonthKey,
	): Promise<GroupBase | null>;
	/** The starting balance row as a money-in entry, for when it is behind a checkpoint. */
	startingBalanceEntry(
		loaded: LoadedBook<R, C>,
		id: string,
	): Promise<MoneyInEntry | undefined>;
}

/** What the owed reads need from a loaded book. */
export function owedInputOf(
	loaded: Pick<LoadedBook, "splits" | "book" | "today" | "missingRates">,
) {
	return {
		replay: loaded.splits.replay,
		events: loaded.splits.events,
		pending: loaded.splits.pending,
		notInBudget: loaded.splits.notInBudget,
		currency: loaded.book.currency,
		today: loaded.today,
		incomplete: loaded.missingRates.length > 0,
	};
}

/** The month view of a source: the same figures on the server and on a device. */
export async function monthViewFrom<
	R extends BookRowCore,
	C extends CloseRowCore,
>(
	src: MonthViewSource<R, C>,
	now: Date,
	month?: MonthKey,
): Promise<MonthRead<R, C> | null> {
	// A past month needs the pass to start before it, not at the last closed one.
	const loaded = await src.loadBook({ now, needFrom: month });
	if (!loaded) return null;
	const key = month ?? loaded.input.currentMonth;
	if (
		key > addMonths(loaded.input.currentMonth, 1) ||
		key < loaded.book.startMonth
	)
		throw new EnvelopeError("INVALID", "that month is outside your budget");
	const state = computeBook(loaded.input, key);
	const groupBase =
		key >= loaded.input.currentMonth && hasPercentGroup(loaded)
			? await src.groupBase(loaded, key)
			: null;
	const view = buildMonthView({
		book: loaded.book,
		input: loaded.input,
		state,
		month: key,
		today: loaded.today,
		missingRates: loaded.missingRates,
		owed: owedSummary(owedInputOf(loaded)),
		groupBase,
		approximateRows: loaded.approximate.length,
		startingMoney: await startingMoneyIn(loaded, key, (id) =>
			src.startingBalanceEntry(loaded, id),
		),
	});
	return { ...view, loaded };
}
