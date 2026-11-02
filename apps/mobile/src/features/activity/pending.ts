import { toMinor } from "@retrospend/domain/money-minor";
import type { OutboxEntry } from "@/data/outbox";
import { canRestore } from "@/features/entry/pendingDraft";
import { isEntryEntity } from "@/features/entry/send";
import type { ActivityItem, ActivityPage } from "./source";

// An entry written on the phone waits in the outbox until the server has it.
// This is how those entries join the Activity read: each becomes a row marked
// `unsynced`, and `mergePending` puts them into the server's page by date. Every
// screen that lists entries (Activity, Home's Recent) goes through here, so a
// new entry shows at once, offline or not.
//
// The totals stay the server's: it computes every figure, and a waiting entry
// has no booked rate yet, so it is not in a day's total or the page's spending.

export interface PendingContext {
	/** The caller's categories, by id. */
	categories: ReadonlyMap<
		string,
		{ id: string; name: string; icon: string | null; tone: number }
	>;
	/** Account names by id, for a transfer's title. */
	places: ReadonlyMap<string, string>;
	/** A transfer with no names to show says this. */
	transferWord: string;
}

type Body = Record<string, unknown>;

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function moneyOf(
	amount: unknown,
	currency: unknown,
): { minor: number; currency: string } | null {
	if (typeof amount !== "string" || typeof currency !== "string") return null;
	try {
		return { minor: toMinor(amount, currency), currency };
	} catch {
		return null;
	}
}

function dayOf(body: Body, entry: OutboxEntry): string {
	const day = body.date;
	return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
		? day
		: entry.createdAt.slice(0, 10);
}

/**
 * The row for one outbox entry, or null when it is not a create the list can
 * draw (an update or delete, or a payload that does not read). A foreign
 * amount shows as entered with no home value: the rate is booked on sync,
 * and a missing rate is never 1.
 */
export function pendingRow(
	entry: OutboxEntry,
	ctx: PendingContext,
): ActivityItem | null {
	if (entry.kind !== "create" || !isEntryEntity(entry.entity)) return null;
	const body = (entry.payload ?? {}) as Body;
	const date = dayOf(body, entry);
	const base = {
		entityId: entry.clientId,
		sortKey: null,
		project: null,
		date,
		mine: true,
		locked: false,
		canEdit: canRestore(entry),
		unsynced: true,
	} as const;
	const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
	const category = categoryId ? ctx.categories.get(categoryId) : undefined;
	const categoryRef = category
		? {
				id: category.id,
				name: category.name,
				icon: category.icon,
				tone: category.tone,
			}
		: null;

	switch (entry.entity) {
		case "expenses": {
			const amount = moneyOf(body.amount, body.currency);
			if (!amount) return null;
			return {
				...base,
				id: entry.clientId,
				source: "personal",
				kind: "expense",
				title: text(body.title),
				category: categoryRef,
				amount,
			};
		}
		case "shared-expenses": {
			const amount = moneyOf(body.amount, body.currency);
			if (!amount) return null;
			return {
				...base,
				id: `shared:${entry.clientId}`,
				source: "shared",
				kind: "expense",
				title: text(body.description),
				category: categoryRef,
				amount,
				project: null,
			};
		}
		case "income": {
			const amount = moneyOf(body.amount, body.currency);
			if (!amount) return null;
			return {
				...base,
				id: entry.clientId,
				source: "personal",
				kind: "income",
				title: text(body.title),
				category: categoryRef,
				amount,
			};
		}
		case "transfers": {
			const amount = moneyOf(body.fromAmount, body.fromCurrency);
			if (!amount) return null;
			const from = ctx.places.get(text(body.fromAccountId));
			const to = ctx.places.get(text(body.toAccountId));
			return {
				...base,
				id: entry.clientId,
				source: "personal",
				kind: "transfer",
				title: from && to ? `${from} > ${to}` : ctx.transferWord,
				category: null,
				amount,
			};
		}
	}
}

/** Waiting entries as rows. `conflict` ones are parked: SyncIssues shows those. */
export function pendingRows(
	entries: readonly OutboxEntry[],
	ctx: PendingContext,
): ActivityItem[] {
	return entries
		.filter((e) => e.state !== "conflict")
		.map((e) => pendingRow(e, ctx))
		.filter((row): row is ActivityItem => row !== null);
}

/**
 * The server's page with the waiting rows in it, newest day first. A row the
 * server already lists (matched by the entry it is about) is the server's:
 * the waiting copy leaves, so a sync swaps the row and never doubles it.
 * Within a day a waiting row goes first, being the newest write. A waiting
 * row older than what the loaded pages reach waits for its page to load.
 */
export function mergePending(
	page: ActivityPage,
	rows: readonly ActivityItem[],
): ActivityPage {
	if (rows.length === 0) return page;
	const have = new Set(page.items.flatMap((i) => [i.id, i.entityId]));
	const last = page.items.at(-1);
	const fresh = rows
		.filter((row) => !have.has(row.entityId) && !have.has(row.id))
		.filter((row) => page.nextCursor === null || !last || row.date >= last.date)
		.slice()
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
	if (fresh.length === 0) return page;
	const items: ActivityItem[] = [];
	let next = 0;
	for (const item of page.items) {
		while (
			next < fresh.length &&
			(fresh[next] as ActivityItem).date >= item.date
		) {
			items.push(fresh[next] as ActivityItem);
			next++;
		}
		items.push(item);
	}
	while (next < fresh.length) items.push(fresh[next++] as ActivityItem);
	return { ...page, items };
}

/**
 * A page of only the waiting rows, for a phone that has nothing cached and no
 * server to ask: the person still sees what they just wrote.
 */
export function pendingPage(
	rows: readonly ActivityItem[],
	input: { today: string; homeCurrency: string },
): ActivityPage {
	return mergePending(
		{
			items: [],
			nextCursor: null,
			today: input.today,
			homeCurrency: input.homeCurrency,
			count: null,
			total: null,
			dayTotals: null,
			missingRates: [],
			elsewhere: null,
		},
		rows,
	);
}
