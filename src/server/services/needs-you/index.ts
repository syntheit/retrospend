/**
 * needsYou(): the one Needs you list (kit `RS.derive.needsYou`, one server
 * read). Every source reads through one RLS transaction, so a user only
 * ever sees their own items; each source is a fixed number of queries
 * (no per-item reads), and the budget items reuse the month view the
 * engine memoizes per transaction.
 */
import { dayKey } from "@retrospend/domain/time-zone";
import { userTransaction } from "~/server/db-tx";
import { monthViewIn } from "~/server/services/envelope/month-read";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { Prisma, PrismaClient } from "~prisma";
import { activityItems, setupItems } from "./activity";
import { budgetItems, type MoneyInFact } from "./budget";
import { compareItems, countByGroup } from "./catalog";
import { loadFaces } from "./faces";
import { peopleItems } from "./people";
import type { NeedsYouItem, NeedsYouList } from "./types";

type Tx = Prisma.TransactionClient;

export interface NeedsYouOptions {
	/** Budget items only with the envelope budget on (`envelopeBudgetMode`). */
	readonly budget: boolean;
	/** The request's zone; else the user's stored zone, else the server default (userTimeZone). */
	readonly timeZone?: string;
	readonly now?: Date;
	/**
	 * Whether this instance can send email (`isEmailDeliveryEnabled`); without
	 * it there is no Verify your email item. The router passes the real value.
	 */
	readonly emailEnabled?: boolean;
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
		// Moves from Wealth are not money that arrived: no title to show.
		moneyIn: await moneyInFacts(
			tx,
			view.loaded.input.moneyIn.flatMap((e) =>
				e.source === "WEALTH" ? [] : [{ ...e, source: e.source }],
			),
			row.timeZone,
		),
	});
}

/** The engine's money in with each row's title and day (one query), for Give it a job. */
async function moneyInFacts(
	tx: Tx,
	entries: readonly {
		id: string;
		minor: number;
		source: MoneyInFact["source"];
	}[],
	bookZone: string,
): Promise<MoneyInFact[]> {
	const counted = entries.filter((e) => e.minor > 0);
	if (!counted.length) return [];
	const rows = await tx.expense.findMany({
		where: { id: { in: counted.map((e) => e.id) } },
		select: { id: true, title: true, date: true },
	});
	const byId = new Map(rows.map((r) => [r.id, r]));
	return counted.flatMap((e) => {
		const r = byId.get(e.id);
		return r ? [{ ...e, title: r.title, date: dayKey(r.date, bookZone) }] : [];
	});
}

/** The list on a transaction the caller opened with RLS set (previews, batched reads). */
export async function needsYouIn(
	tx: Tx,
	userId: string,
	options: NeedsYouOptions,
): Promise<NeedsYouList> {
	const now = options.now ?? new Date();
	const timeZone = await userTimeZone(tx, userId, options.timeZone);
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
		...(await setupItems(tx, user, options.emailEnabled ?? true)),
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
