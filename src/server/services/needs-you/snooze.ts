/**
 * Later on a Needs you item: it leaves the list until the start of the
 * viewer's next day, then comes back by itself. Undo is the same state
 * removed. Stored on the server so every device agrees and the nav badges
 * (counts per group) never count what is snoozed.
 *
 * An item that changes type has a new id, so it comes back by itself: a bill
 * pushed to tomorrow returns as overdue (`recurring.overdue:<id>`), not as
 * the due item that was snoozed.
 *
 * Rows hold the item's stable id (`<type>:<entity id>`) and a time, never a
 * title. The client makes the row id, so a retried request lands on the same
 * row. Not a money action: nothing here moves a figure, so there is no
 * preview.
 */
import { startOfNextDayIn } from "@retrospend/domain/time-zone";
import { userTransaction } from "~/server/db-tx";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { Prisma, PrismaClient } from "~prisma";

type Tx = Prisma.TransactionClient;

export interface SnoozeResult {
	readonly itemId: string;
	/** When the item comes back. */
	readonly until: Date;
}

/** The ids of items snoozed at `now`, for the list to leave out. */
export async function snoozedIds(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<ReadonlySet<string>> {
	const rows = await tx.needsYouSnooze.findMany({
		where: { userId, until: { gt: now } },
		select: { itemId: true },
	});
	return new Set(rows.map((row) => row.itemId));
}

export async function snoozeIn(
	tx: Tx,
	userId: string,
	input: { readonly id: string; readonly itemId: string },
	options: { timeZone?: string; now?: Date } = {},
): Promise<SnoozeResult> {
	const now = options.now ?? new Date();
	const zone = await userTimeZone(tx, userId, options.timeZone);
	const until = startOfNextDayIn(now, zone);
	// Rows that already ended are noise; the user's own are all this can touch (RLS).
	await tx.needsYouSnooze.deleteMany({
		where: { userId, until: { lte: now } },
	});
	await tx.needsYouSnooze.upsert({
		where: { userId_itemId: { userId, itemId: input.itemId } },
		create: { id: input.id, userId, itemId: input.itemId, until },
		update: { until },
	});
	return { itemId: input.itemId, until };
}

export async function unsnoozeIn(
	tx: Tx,
	userId: string,
	input: { readonly itemId: string },
): Promise<{ readonly itemId: string }> {
	await tx.needsYouSnooze.deleteMany({
		where: { userId, itemId: input.itemId },
	});
	return { itemId: input.itemId };
}

export const snooze = (
	db: PrismaClient,
	userId: string,
	input: { id: string; itemId: string },
	options?: { timeZone?: string; now?: Date },
) => userTransaction(db, userId, (tx) => snoozeIn(tx, userId, input, options));

export const unsnooze = (
	db: PrismaClient,
	userId: string,
	input: { itemId: string },
) => userTransaction(db, userId, (tx) => unsnoozeIn(tx, userId, input));
