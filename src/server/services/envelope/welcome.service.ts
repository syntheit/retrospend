/**
 * Welcome back (SPEC §5.5, S26, B10) and reconcile (SPEC §5.11, D16 c).
 *
 * Welcome back waits when someone opens the budget after 35 or more days
 * away with closes they have not read, or resumes from Just track. One calm
 * sheet, three choices, no blame:
 * - Catch up: the summaries to open, oldest first;
 * - Set what I have now: one Adjustment so the budget holds exactly that
 *   amount; envelopes keep what they hold;
 * - Start fresh: one RESET batch returns every envelope's Left to To assign;
 *   envelopes, targets, rules and history stay.
 *
 * Reconcile records the difference between the bank and the budget as an
 * Adjustment (0 records that it matched) and starts the monthly reminder.
 */
import type {
	Adjustment,
	ReconcileInput,
	WelcomeBack,
	WelcomeBackInput,
	WelcomeBackResult,
} from "~/lib/schemas/envelope-book";
import type { Prisma } from "~prisma";
import { writeAdjustment } from "./adjustment";
import { bankSide, budgetHolds } from "./bank";
import { EnvelopeError } from "./errors";
import { resetEnvelopes } from "./fix.service";
import { findPersonalBook } from "./inputs";
import { forgetMonthViews, type MonthRead, monthViewIn } from "./month-read";
import { isoDateIn } from "./months";
import { lockBook } from "./movement-state";

type Tx = Prisma.TransactionClient;

/** Days away after which a first open with closes waiting says Welcome back. */
export const AWAY_DAYS = 35;
const DAY_MS = 86_400_000;
/** lastOpenedAt is written at most this often (a read writes nothing in between). */
const TOUCH_MS = 12 * 60 * 60 * 1000;

/**
 * Records a budget read; after 35 days away with an unread close, Welcome
 * back starts waiting. Called by getMonth after the lazy close.
 */
export async function touchOpened(tx: Tx, userId: string, now: Date) {
	const book = await tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: { id: true, lastOpenedAt: true, welcomeBackFrom: true },
	});
	if (!book) return;
	const last = book.lastOpenedAt;
	if (last && now.getTime() - last.getTime() < TOUCH_MS) return;
	const away = last !== null && now.getTime() - last.getTime() >= AWAY_DAYS * DAY_MS;
	const unread =
		away &&
		(await tx.monthClose.count({
			where: { bookId: book.id, acknowledgedAt: null },
		})) > 0;
	await tx.budgetBook.update({
		where: { id: book.id },
		data: {
			lastOpenedAt: now,
			...(unread && !book.welcomeBackFrom ? { welcomeBackFrom: last } : {}),
		},
	});
}

async function requireView(tx: Tx, userId: string, now: Date) {
	const view = await monthViewIn(tx, userId, now);
	if (!view) throw new EnvelopeError("NO_BOOK", "start a budget first");
	return view;
}

/** The closes still waiting for a read, oldest first. */
async function waitingMonths(tx: Tx, bookId: string) {
	const rows = await tx.monthClose.findMany({
		where: { bookId },
		orderBy: { month: "asc" },
		select: { month: true, revision: true, ackRevision: true },
	});
	return rows
		.filter((r) => (r.ackRevision ?? 0) < r.revision)
		.map((r) => ({ month: r.month, revision: r.revision, acknowledged: false }));
}

export async function welcomeBackState(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<WelcomeBack> {
	const view = await requireView(tx, userId, now);
	const row = view.loaded.row;
	return {
		pending: row.welcomeBackFrom !== null,
		since: row.welcomeBackFrom
			? isoDateIn(row.welcomeBackFrom, row.timeZone)
			: null,
		months: await waitingMonths(tx, row.id),
		bank: await bankSide(tx, userId, view),
	};
}

async function adjustTo(
	tx: Tx,
	userId: string,
	view: MonthRead,
	p: { id: string; haveNow: number; now: Date },
): Promise<Adjustment> {
	return writeAdjustment(tx, userId, {
		id: p.id,
		signedMinor: p.haveNow - budgetHolds(view),
		currency: view.loaded.book.currency,
		rateType: view.loaded.valuation.defaultRateType,
		date: p.now,
		today: view.loaded.today,
	});
}

export async function welcomeBack(
	tx: Tx,
	userId: string,
	input: WelcomeBackInput,
	now: Date,
): Promise<WelcomeBackResult> {
	const book = await findPersonalBook(tx, userId);
	if (!book?.defaultEnvelopeId)
		throw new EnvelopeError("NO_BOOK", "start a budget first");
	await lockBook(tx, book.id);
	const months = (await waitingMonths(tx, book.id)).map((m) => m.month);
	const out: WelcomeBackResult = {
		choice: input.choice,
		adjustment: null,
		movements: null,
		months,
	};
	if (input.choice === "SET_HAVE_NOW")
		out.adjustment = await adjustTo(tx, userId, await requireView(tx, userId, now), {
			id: input.id,
			haveNow: input.amountMinor,
			now,
		});
	if (input.choice === "START_FRESH")
		out.movements = await resetEnvelopes(
			tx,
			userId,
			{ batchId: input.batchId },
			now,
		).catch((error) => {
			// Every envelope already at 0: starting fresh moves nothing.
			if (error instanceof EnvelopeError && error.code === "INVALID") return null;
			throw error;
		});
	await tx.budgetBook.update({
		where: { id: book.id },
		data: { welcomeBackFrom: null },
	});
	forgetMonthViews(tx);
	return out;
}

/** Records what the bank says: the difference as an Adjustment, and the reminder from now on. */
export async function reconcile(
	tx: Tx,
	userId: string,
	input: ReconcileInput,
	now: Date,
): Promise<Adjustment> {
	const book = await findPersonalBook(tx, userId);
	if (!book?.defaultEnvelopeId)
		throw new EnvelopeError("NO_BOOK", "start a budget first");
	await lockBook(tx, book.id);
	const view = await requireView(tx, userId, now);
	const signed = input.direction === "IN" ? input.amountMinor : -input.amountMinor;
	const adjustment = await writeAdjustment(tx, userId, {
		id: input.id,
		signedMinor: signed,
		currency: book.currency,
		rateType: view.loaded.valuation.defaultRateType,
		date: now,
		today: view.loaded.today,
	});
	await tx.budgetBook.update({
		where: { id: book.id },
		data: { reconciledAt: now },
	});
	forgetMonthViews(tx);
	return adjustment;
}
