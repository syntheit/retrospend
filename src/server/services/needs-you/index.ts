/**
 * needsYou(): the one Needs you list (kit `RS.derive.needsYou`, one server
 * read). Every source reads through one RLS transaction, so a user only
 * ever sees their own items; each source is a fixed number of queries
 * (no per-item reads), and the budget items reuse the month view the
 * engine memoizes per transaction.
 */
import { dayKey } from "@retrospend/domain/time-zone";
import { userTransaction } from "~/server/db-tx";
import { hiddenRowCount } from "~/server/services/envelope/hidden-rows";
import type { LoadedBook } from "~/server/services/envelope/inputs";
import { ensureLegacyBook } from "~/server/services/envelope/legacy-lazy";
import {
	monthViewIn,
	owedInputOf,
} from "~/server/services/envelope/month-read";
import { isoDateIn, monthRange } from "~/server/services/envelope/months";
import { owedPeople } from "~/server/services/envelope/owed";
import { runPendingRules } from "~/server/services/envelope/rule.service";
import { computeBalanceBatch } from "~/server/services/shared-expenses/balance-batch";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { Prisma, PrismaClient } from "~prisma";
import { activityItems, setupItems } from "./activity";
import {
	type BudgetFacts,
	budgetItems,
	type CloseFacts,
	type MoneyInFact,
} from "./budget";
import { compareItems, countByGroup } from "./catalog";
import { loadFaces } from "./faces";
import { peopleItems } from "./people";
import { snoozedIds } from "./snooze";
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
	// Rules take their part of new money in first (sidecar rows), so Give it a job shows what is left (S24).
	await runPendingRules(tx, userId, now);
	const view = await monthViewIn(tx, userId, now);
	if (!view) return [];
	const row = view.loaded.row;
	return budgetItems({
		dto: view.dto,
		paused: row.pausedAt !== null,
		startingMoneyUnconfirmed: row.startingMoneyConfirmedAt === null,
		closes: closeFacts(view.loaded, now),
		hiddenRows: await hiddenRowCount(tx, userId, row),
		...(await agingFacts(tx, userId, view.loaded)),
		reconcileDue:
			row.reconciledAt !== null &&
			isoDateIn(row.reconciledAt, row.timeZone) < view.dto.month.from,
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

/**
 * The people the budget's replay calls aging, with what each owes you in
 * People's ledger: one batched read (computeBalanceBatch, the one behind
 * owed.owedToYou), and none when nobody is aging.
 */
async function agingFacts(
	tx: Tx,
	userId: string,
	loaded: LoadedBook,
): Promise<Pick<BudgetFacts, "owed" | "balances">> {
	const owed = owedPeople(owedInputOf(loaded));
	const aging = owed.filter((p) => p.aging);
	if (aging.length === 0) return { owed };
	const me: ParticipantRef = { participantType: "user", participantId: userId };
	const people: ParticipantRef[] = aging.map((p) => ({
		participantType: p.participant.type,
		participantId: p.participant.id,
	}));
	const rows = await computeBalanceBatch(tx, me, people);
	return {
		owed,
		balances: new Map(
			aging.map((p, i) => [
				`${p.participant.type}:${p.participant.id}`,
				rows[i]?.minorByCurrency ?? {},
			]),
		),
	};
}

/** A summary waits this long after its close unless acknowledged (SPEC §5.14). */
const SUMMARY_DAYS = 7;

/** Closes waiting to be read and the newest change after a late window, from the closes the view loaded. */
export function closeFacts(loaded: LoadedBook, now: Date): CloseFacts {
	const since = now.getTime() - SUMMARY_DAYS * 86_400_000;
	const from = (m: number) => monthRange(m, loaded.periods).from;
	const waiting = loaded.closes
		.filter((c) => c.acknowledgedAt === null && c.closedAt.getTime() >= since)
		.map((c) => ({ month: c.month, from: from(c.month) }));
	const unread = loaded.closes.filter(
		(c) => c.revision > 1 && c.recalc && (c.ackRevision ?? 0) < c.revision,
	);
	const newest = unread
		.map((c) => c.recalc)
		.sort((a, b) => ((a?.at ?? "") < (b?.at ?? "") ? 1 : -1))[0];
	const changed = newest
		? {
				earliestMonth: newest.earliestMonth,
				earliestFrom: from(newest.earliestMonth),
				toAssign: newest.toAssign,
				envelopes: newest.envelopes,
			}
		: null;
	return { waiting, changed };
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
	const all = [
		...people.items,
		...(await activityItems(tx, userId, now, timeZone)),
		...(options.budget ? await budgetSource(tx, userId, now) : []),
		...(await setupItems(tx, user, options.emailEnabled ?? true)),
	].sort(compareItems);
	// Later: what the person pushed to tomorrow is out of the list and the counts.
	const later = await snoozedIds(tx, userId, now);
	const items = all.filter((item) => !later.has(item.id));
	const faces = new Set([...people.faces, ...items.flatMap((i) => i.people)]);
	return {
		today: dayKey(now, timeZone),
		items,
		counts: countByGroup(items),
		people: await loadFaces(tx, faces),
	};
}

export async function needsYou(
	db: PrismaClient,
	userId: string,
	options: NeedsYouOptions,
): Promise<NeedsYouList> {
	// A person with old limits and no book moves in on this first read (02 §6),
	// before the read's own transaction opens and without ever failing it.
	if (options.budget)
		await ensureLegacyBook(
			db,
			userId,
			options.now ?? new Date(),
			options.timeZone ?? null,
		);
	return userTransaction(db, userId, (tx) => needsYouIn(tx, userId, options));
}
