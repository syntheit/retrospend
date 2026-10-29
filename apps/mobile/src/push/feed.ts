import type { RetrospendClient } from "@retrospend/api-client";
import type { KeyValueStore } from "@/data/store";
import type { NotificationPreference } from "@/features/settings/source";
import { PUSH_KINDS, type PushKind, pushKindOf } from "./kinds";

// Android without Google services has no push channel yet (FCM and
// UnifiedPush are deferred), so the app polls the same feeds the server's
// push worker reads and posts local notifications:
// - the events feed (GET /events): a change somebody else made to a thing
//   you share arrives in your feed with the actor's id;
// - Needs you: recurring items that fell due, which no event announces.
// The text is made on the phone from the kind (push.json), like the server
// makes it for APNs, so no title or note is ever read for a notification.

/** Events older than the push time-to-live are not announced. */
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
/** At most this many notifications per run, newest kept. */
export const MAX_PER_RUN = 10;
const PAGE_LIMIT = 100;
/** Pages read per run; a long backlog continues on the next run. */
export const MAX_PAGES = 20;
/** Recurring items that fell due longer ago than this are not announced (server: 3 days). */
export const RECURRING_LOOKBACK_DAYS = 3;
const MAX_REMEMBERED = 100;

export interface LocalNotification {
	/** Stable per event or recurring item and day, so a repeat replaces. */
	key: string;
	kind: PushKind;
	direction?: "in" | "out";
	entity: { type: string; id: string } | null;
}

export interface FeedEvent {
	cursor: string;
	type: string;
	occurredAt: string;
	actorUserId: string | null;
	entity: { type: string; id: string } | null;
	id: string;
}

type PushFlags = Pick<NotificationPreference, "type" | "push">[];

/** A type with no stored row pushes, as on the server. */
export function pushAllowed(
	prefs: PushFlags,
	preference: NotificationPreference["type"],
): boolean {
	return prefs.find((p) => p.type === preference)?.push ?? true;
}

/**
 * The notifications a page of events makes: kinds that push, made by
 * someone else, recent, and not switched off. The caller's own writes sit in
 * the same feed and never notify.
 */
export function notificationsFromEvents(
	events: FeedEvent[],
	options: {
		meId: string;
		prefs: PushFlags;
		now: Date;
	},
): LocalNotification[] {
	const out: LocalNotification[] = [];
	for (const event of events) {
		const kind = pushKindOf(event.type);
		if (!kind || event.actorUserId === options.meId) continue;
		if (!event.entity) continue;
		const age = options.now.getTime() - Date.parse(event.occurredAt);
		if (!(age <= MAX_EVENT_AGE_MS)) continue;
		if (!pushAllowed(options.prefs, PUSH_KINDS[kind].preference)) continue;
		out.push({ key: `event:${event.id}`, kind, entity: event.entity });
	}
	return out;
}

type NeedsItem = Pick<
	Awaited<ReturnType<RetrospendClient["needs-you"]["list"]>>["items"][number],
	"type" | "entity" | "date" | "direction"
>;

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Recurring items that fell due in the last few days, once per item and day. */
export function notificationsFromNeedsYou(
	items: NeedsItem[],
	today: string,
	allowed: boolean,
): LocalNotification[] {
	if (!allowed) return [];
	const out: LocalNotification[] = [];
	for (const item of items) {
		if (item.type !== "recurring.due" && item.type !== "recurring.overdue")
			continue;
		if (!item.entity || !item.date) continue;
		const late = daysBetween(item.date, today);
		if (late > RECURRING_LOOKBACK_DAYS) continue;
		out.push({
			key: `recurring:${item.entity.id}:${item.date}`,
			kind: "recurring.due",
			direction: item.direction ?? undefined,
			entity: { type: "recurring", id: item.entity.id },
		});
	}
	return out;
}

/** What the poll keeps between runs, per account. */
export function createFeedState(store: KeyValueStore, scope: string) {
	const cursorKey = `push.cursor.${scope}`;
	const seenKey = `push.seen.${scope}`;
	return {
		getCursor: () => store.get(cursorKey),
		setCursor: (cursor: string) => store.set(cursorKey, cursor),
		async seen(): Promise<string[]> {
			const raw = await store.get(seenKey);
			try {
				const v = raw ? JSON.parse(raw) : [];
				return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
			} catch {
				return [];
			}
		},
		async remember(keys: string[]): Promise<void> {
			const all = [...(await this.seen()), ...keys].slice(-MAX_REMEMBERED);
			await store.set(seenKey, JSON.stringify(all));
		},
		async clear(): Promise<void> {
			await store.delete(cursorKey);
			await store.delete(seenKey);
		},
	};
}
export type FeedState = ReturnType<typeof createFeedState>;

type FeedApi = {
	events: Pick<RetrospendClient["events"], "list">;
	notifications: Pick<RetrospendClient["notifications"], "getPreferences">;
	"needs-you": Pick<RetrospendClient["needs-you"], "list">;
};

/** What one poll found, and the step that saves its progress once posted. */
export interface Poll {
	notifications: LocalNotification[];
	commit(): Promise<void>;
}

/**
 * One poll.With no stored cursor the run only walks to the end of the feed
 * (what happened before push was switched on is not news). Nothing is saved
 * here: the caller posts what came back and then calls `commit`, which moves
 * the cursor (also when nothing was announced) and remembers the keys. A run
 * that fails or is cut short before that leaves the cursor where it was, so
 * the next run reads the same events again and loses nothing; a repeat has
 * the same key and replaces the notification already shown.
 */
export async function pollFeed(args: {
	api: FeedApi;
	state: FeedState;
	meId: string;
	now?: Date;
}): Promise<Poll> {
	const { api, state, meId } = args;
	const now = args.now ?? new Date();
	const stored = await state.getCursor();
	let cursor = stored;
	const firstRun = cursor === null;
	const prefs = (await api.notifications.getPreferences()).preferences;
	const fresh: LocalNotification[] = [];

	for (let page = 0; page < MAX_PAGES; page++) {
		const result = await api.events.list({
			...(cursor ? { after: cursor } : {}),
			limit: PAGE_LIMIT,
		});
		if (!firstRun) {
			fresh.push(
				...notificationsFromEvents(result.items, {
					meId,
					prefs,
					now,
				}),
			);
		}
		if (result.cursor && result.cursor !== cursor) cursor = result.cursor;
		if (!result.hasMore) break;
	}

	const needs = await api["needs-you"].list();
	fresh.push(
		...notificationsFromNeedsYou(
			needs.items,
			needs.today,
			pushAllowed(prefs, "RECURRING_DUE"),
		),
	);

	const seen = new Set(await state.seen());
	const unseen = fresh.filter(
		(n, i) => !seen.has(n.key) && fresh.findIndex((m) => m.key === n.key) === i,
	);
	return {
		notifications: unseen.slice(-MAX_PER_RUN),
		async commit() {
			// A first run never has a cursor to resume from when the feed is
			// empty; an empty marker keeps later runs from starting over.
			const next = cursor ?? "";
			if (next !== stored) await state.setCursor(next);
			await state.remember(unseen.map((n) => n.key));
		},
	};
}
