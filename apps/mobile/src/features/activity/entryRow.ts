import type { ReadCache } from "@/data/cache";
import { ACTIVITY_CACHE, type ActivityItem, type ActivityPage } from "./source";

// One entry's read view reads its row from the server by id (GET
// /expenses/row), never from what opened it: a row passed along goes stale
// after an edit or a delete, and a link can carry anything. What the list
// passed is only a placeholder while the server answers, and only once it
// reads as a row with this id.

export type EntryRowState =
	/** The server has not answered; `placeholder` is what the list showed. */
	| { status: "loading"; placeholder: ActivityItem | null }
	| {
			status: "ready";
			item: ActivityItem;
			/** Set when the server could not be reached: when the row was read. */
			staleSince: string | null;
	  }
	/** Deleted, or you are no longer on it. */
	| { status: "missing" }
	| { status: "error" };

export const ENTRY_ROW_PREFIX = "activity.row.";
const SCHEMA = 1;

type Shape = Record<string, unknown>;
const isObject = (v: unknown): v is Shape =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const isMoney = (v: unknown) =>
	isObject(v) &&
	Number.isSafeInteger(v.minor) &&
	typeof v.currency === "string";
const optional = (v: unknown, check: (v: unknown) => boolean) =>
	v === undefined || v === null || check(v);
const SOURCES = ["personal", "shared", "payment"];
const KINDS = ["expense", "income", "refund", "transfer", "payment"];

/**
 * Whether `v` reads as an Activity row: every field the view draws, with its
 * type, and a real day. A crafted link fails this and shows nothing of its own.
 */
export function isActivityRow(v: unknown): v is ActivityItem {
	if (!isObject(v)) return false;
	const day = typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date);
	return (
		typeof v.id === "string" &&
		SOURCES.includes(v.source as string) &&
		typeof v.entityId === "string" &&
		KINDS.includes(v.kind as string) &&
		typeof v.title === "string" &&
		isMoney(v.amount) &&
		optional(v.home, isMoney) &&
		optional(v.share, isMoney) &&
		optional(
			v.category,
			(c) => isObject(c) && optional(c.name, (n) => typeof n === "string"),
		) &&
		optional(v.project, (p) => isObject(p) && typeof p.name === "string") &&
		optional(
			v.people,
			(list) =>
				Array.isArray(list) &&
				list.every(
					(p) =>
						isObject(p) &&
						typeof p.id === "string" &&
						typeof p.name === "string",
				),
		) &&
		day &&
		!Number.isNaN(Date.parse(v.date as string)) &&
		typeof v.mine === "boolean" &&
		typeof v.locked === "boolean" &&
		typeof v.canEdit === "boolean"
	);
}

/** The row a link or the list passed, if it is a row with this id; otherwise nothing. */
export function rowFromParam(
	raw: unknown,
	id: string | undefined,
): ActivityItem | null {
	if (typeof raw !== "string" || !id) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return isActivityRow(parsed) && parsed.id === id ? parsed : null;
}

const notFound = (error: unknown) =>
	(error as { status?: number } | null)?.status === 404;

/**
 * The row fresh from the server. A row that is gone is missing, and the copy
 * kept for it is dropped. Offline, the last copy of this row, or the cached
 * Activity page's, shows marked stale; with neither it is an error.
 */
export async function loadEntryRow(
	id: string,
	fetch: () => Promise<ActivityItem>,
	cache: ReadCache | null,
): Promise<EntryRowState> {
	const name = `${ENTRY_ROW_PREFIX}${id}`;
	try {
		const item = await fetch();
		if (cache) {
			await cache.write(name, SCHEMA, item);
			await cache.prune(ENTRY_ROW_PREFIX, 40);
		}
		return { status: "ready", item, staleSince: null };
	} catch (error) {
		if (notFound(error)) {
			if (cache) await cache.write(name, SCHEMA, null);
			return { status: "missing" };
		}
		if (!cache) return { status: "error" };
		const own = await cache.read<ActivityItem | null>(name, SCHEMA);
		if (own) {
			return own.data
				? { status: "ready", item: own.data, staleSince: own.fetchedAt }
				: { status: "missing" };
		}
		const page = await cache.read<ActivityPage>(
			ACTIVITY_CACHE.name,
			ACTIVITY_CACHE.schema,
		);
		const listed = page?.data.items.find((row) => row.id === id);
		return listed && page
			? { status: "ready", item: listed, staleSince: page.fetchedAt }
			: { status: "error" };
	}
}
