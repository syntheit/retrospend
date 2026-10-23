/**
 * Read models of the envelope budget on a given transaction: the month
 * view, the verdict, Left to spend, Use my plan's proposal, cover sources
 * and history. Figures and previews call these inside their transaction;
 * read.service.ts opens one per request for the transports.
 */
import type {
	CoverSource,
	FillFromTargetsOutput,
	HistoryInput,
	HistoryOutput,
} from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { addMonths } from "./calendar";
import { computeBook } from "./engine";
import { EnvelopeError } from "./errors";
import { savedPlanLines } from "./draft-store";
import { groupBaseFor, hasPercentGroup } from "./income-history";
import { type LoadedBook, loadBook } from "./inputs";
import { buildMonthView, type MonthView } from "./month-view";
import { owedSummary } from "./owed";
import { coverSources, fillFromTargets } from "./planning";
import type { Minor, MonthKey } from "./types";
import { toMinor } from "./units";

type Tx = Prisma.TransactionClient;

export interface MonthRead extends MonthView {
	loaded: LoadedBook;
}

/**
 * Month views per transaction: a preview reads several figures before and
 * after its write, and each reads the same view. Writers call
 * forgetMonthViews(tx) after they write, so the after side sees the write.
 */
const views = new WeakMap<object, Map<string, Promise<MonthRead | null>>>();

export function forgetMonthViews(tx: Tx) {
	views.delete(tx);
}

/** Null when the user has no book (Just track). Memoized per transaction until its next write. */
export function monthViewIn(
	tx: Tx,
	userId: string,
	now: Date,
	month?: MonthKey,
): Promise<MonthRead | null> {
	let byKey = views.get(tx);
	if (!byKey) {
		byKey = new Map();
		views.set(tx, byKey);
	}
	const key = `${userId}:${month ?? "current"}`;
	const cached = byKey.get(key);
	if (cached) return cached;
	const view = computeMonthView(tx, userId, now, month);
	byKey.set(key, view);
	view.catch(() => byKey.delete(key));
	return view;
}

async function computeMonthView(
	tx: Tx,
	userId: string,
	now: Date,
	month?: MonthKey,
): Promise<MonthRead | null> {
	const loaded = await loadBook(tx, userId, { now });
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
			? await groupBaseFor(tx, loaded, key)
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
	});
	return { ...view, loaded };
}

/** What the owed reads need from a loaded book. */
export function owedInputOf(loaded: LoadedBook) {
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

async function requireView(
	tx: Tx,
	userId: string,
	now: Date,
	month?: MonthKey,
) {
	const view = await monthViewIn(tx, userId, now, month);
	if (!view) throw new EnvelopeError("NO_BOOK", "start a budget first");
	return view;
}

export async function fillFromTargetsIn(
	tx: Tx,
	userId: string,
	now: Date,
	month?: MonthKey,
	amount?: Minor,
): Promise<FillFromTargetsOutput> {
	const view = await requireView(tx, userId, now, month);
	if (view.dto.month.state === "CLOSED")
		throw new EnvelopeError("MONTH_CLOSED", "that month has closed");
	const plan = await savedPlanLines(tx, view.dto.book.id, view.dto.month.key);
	return fillFromTargets(view.dto, amount, plan);
}

export async function coverSourcesIn(
	tx: Tx,
	userId: string,
	now: Date,
	envelopeId: string,
	month?: MonthKey,
): Promise<CoverSource[]> {
	const view = await requireView(tx, userId, now, month);
	return coverSources(view.dto, envelopeId);
}

/** Movements newest first, with whether each can still be undone (D28). */
export async function historyIn(
	tx: Tx,
	userId: string,
	now: Date,
	input: HistoryInput,
): Promise<HistoryOutput> {
	const loaded = await loadBook(tx, userId, { now });
	if (!loaded) throw new EnvelopeError("NO_BOOK", "start a budget first");
	const cursor = input.cursor
		? await tx.budgetMovement.findFirst({
				where: { id: input.cursor, bookId: loaded.row.id },
			})
		: null;
	const rows = await tx.budgetMovement.findMany({
		where: {
			bookId: loaded.row.id,
			...(input.month ? { month: input.month } : {}),
			// Both filters are ORs, so they go under one AND instead of spread keys overwriting each other.
			AND: [
				input.envelopeId
					? {
							OR: [
								{ fromEnvelopeId: input.envelopeId },
								{ toEnvelopeId: input.envelopeId },
							],
						}
					: {},
				cursor
					? {
							OR: [
								{ createdAt: { lt: cursor.createdAt } },
								{ createdAt: cursor.createdAt, id: { lt: cursor.id } },
							],
						}
					: {},
			],
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: input.limit + 1,
	});
	const page = rows.slice(0, input.limit);
	const reverted = new Set(
		(
			await tx.budgetMovement.findMany({
				where: { revertsId: { in: page.map((r) => r.id) } },
				select: { revertsId: true },
			})
		).map((r) => r.revertsId),
	);
	const H = loaded.book.currency;
	return {
		items: page.map((r) => ({
			id: r.id,
			month: r.month,
			from: r.fromEnvelopeId,
			to: r.toEnvelopeId,
			amount: { minor: toMinor(r.amount.toString(), H), currency: H },
			kind: r.kind,
			batchId: r.batchId,
			revertsId: r.revertsId,
			createdAt: r.createdAt,
			canUndo:
				r.kind !== "UNDO" &&
				!reverted.has(r.id) &&
				r.month >= loaded.input.currentMonth,
		})),
		nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
	};
}
