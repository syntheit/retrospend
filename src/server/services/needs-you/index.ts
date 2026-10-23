/**
 * needsYou(): the one Needs you list (kit `RS.derive.needsYou`, one server
 * read). Every source reads through one RLS transaction, so a user only
 * ever sees their own items; each source is a fixed number of queries
 * (no per-item reads), and the budget items reuse the month view the
 * engine memoizes per transaction.
 */
import { dayKey, normalizeTimeZone } from "@retrospend/domain/time-zone";
import { userTransaction } from "~/server/db-tx";
import { monthViewIn } from "~/server/services/envelope/month-read";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { Prisma, PrismaClient } from "~prisma";
import { activityItems, setupItems } from "./activity";
import { budgetItems } from "./budget";
import { compareItems, countByGroup } from "./catalog";
import { loadFaces } from "./faces";
import { peopleItems } from "./people";
import type { NeedsYouItem, NeedsYouList } from "./types";

type Tx = Prisma.TransactionClient;

export interface NeedsYouOptions {
	/** Budget items only with the envelope budget on (`envelopeBudgetMode`). */
	readonly budget: boolean;
	/** The request's zone; the server's choice for the user otherwise. */
	readonly timeZone?: string;
	readonly now?: Date;
}

async function budgetSource(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<NeedsYouItem[]> {
	const view = await monthViewIn(tx, userId, now);
	if (!view) return [];
	const row = view.loaded.row;
	return budgetItems({
		dto: view.dto,
		paused: row.pausedAt !== null,
		startingMoneyUnconfirmed: row.startingMoneyConfirmedAt === null,
	});
}

/** The list on a transaction the caller opened with RLS set (previews, batched reads). */
export async function needsYouIn(
	tx: Tx,
	userId: string,
	options: NeedsYouOptions,
): Promise<NeedsYouList> {
	const now = options.now ?? new Date();
	const timeZone =
		normalizeTimeZone(options.timeZone) ?? (await userTimeZone(userId));
	const user = await tx.user.findUnique({
		where: { id: userId },
		select: { id: true, emailVerified: true },
	});
	if (!user) throw new Error("needsYou: no such user");
	const people = await peopleItems(
		tx,
		{ participantType: "user", participantId: userId },
		timeZone,
	);
	const items = [
		...people.items,
		...(await activityItems(tx, userId, now, timeZone)),
		...(options.budget ? await budgetSource(tx, userId, now) : []),
		...(await setupItems(tx, user)),
	].sort(compareItems);
	return {
		today: dayKey(now, timeZone),
		items,
		counts: countByGroup(items),
		people: await loadFaces(tx, people.faces),
	};
}

export function needsYou(
	db: PrismaClient,
	userId: string,
	options: NeedsYouOptions,
): Promise<NeedsYouList> {
	return userTransaction(db, userId, (tx) => needsYouIn(tx, userId, options));
}
