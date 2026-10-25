import {
	AUDIT_ACTIONS,
	MAX_LAST_ACTIVITY_IDS,
	MAX_REVISION_IDS,
} from "@retrospend/api-contract";
import type { activityQuerySchema } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import { db as globalDb } from "~/server/db";
import { toMinor } from "~/server/services/envelope/units";
import type { LedgerCaller } from "./money-op";
import { trpcAuditLog } from "./trpc-bridge";

/**
 * v1 adapters for the activity feed and the expense history. The reads are
 * the auditLog procedures run in-process (the same membership rules). The
 * web's presentation (formatted amounts, clipped and quoted names, relative
 * time, icons) is dropped: an entry carries its summary key, the raw
 * parameters, Money and the stored change record, and the client words it.
 */

type Query = z.infer<typeof activityQuerySchema>;
type Action = (typeof AUDIT_ACTIONS)[number];
type Changes = Record<string, unknown> | null;

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

const idList = (ids: string, max: number) => {
	const list = [...new Set(ids.split(",").filter(Boolean))];
	if (list.length > max) throw bad(`At most ${max} ids`);
	return list;
};

function filtersOf(q: Query) {
	const actions = q.actions
		? q.actions.split(",").filter(Boolean)
		: undefined;
	const unknown = actions?.filter((a) => !AUDIT_ACTIONS.includes(a as Action));
	if (unknown?.length) throw bad(`Unknown action ${unknown.join(", ")}`);
	if (Boolean(q.actorType) !== Boolean(q.actorId))
		throw bad("actorType and actorId go together");
	if (!actions?.length && !q.actorType) return undefined;
	return {
		actions: actions as Action[] | undefined,
		actorType: q.actorType,
		actorId: q.actorId,
	};
}

/** The stored change records of entries the caller was already let read. */
async function changesOf(ids: string[]): Promise<Map<string, Changes>> {
	if (ids.length === 0) return new Map();
	const rows = await globalDb.auditLogEntry.findMany({
		where: { id: { in: ids } },
		select: { id: true, changes: true },
	});
	return new Map(
		rows.map((r) => [
			r.id,
			r.changes && typeof r.changes === "object" && !Array.isArray(r.changes)
				? (r.changes as Record<string, unknown>)
				: null,
		]),
	);
}

/** Parameters the summary builder writes as "<decimal> <currency>" (see SUMMARY_FORMATS). */
const AMOUNT_PARAMS = new Set(["amount", "from", "to", "offset", "total"]);
const RAW_AMOUNT = /^(-?\d+(?:\.\d+)?) ([A-Z0-9]{2,10})$/;

function partsOf(raw: Record<string, string> | null) {
	const params: Record<string, string> = {};
	const amounts: Record<string, { minor: number; currency: string }> = {};
	for (const [key, value] of Object.entries(raw ?? {})) {
		const m = AMOUNT_PARAMS.has(key) ? RAW_AMOUNT.exec(value) : null;
		if (m?.[1] && m[2])
			amounts[key] = { minor: toMinor(m[1], m[2]), currency: m[2] };
		else params[key] = value;
	}
	return { params: raw ? params : null, amounts };
}

type Entry = {
	id: string;
	timestamp: string;
	actor: {
		name: string;
		type: "user" | "guest" | "system" | "unknown";
		id: string | null;
		avatarUrl: string | null;
	};
	action: { type: string; label: string };
	summary: string;
	summaryKey: string | null;
	rawParams: Record<string, string> | null;
	target: { type: string; id: string; label: string | null };
};

const entryOf = (e: Entry, changes: Map<string, Changes>) => ({
	id: e.id,
	timestamp: e.timestamp,
	actor: e.actor,
	action: { type: e.action.type, label: e.action.label },
	summaryKey: e.summaryKey,
	...partsOf(e.rawParams),
	summary: e.summary,
	target: e.target,
	changes: changes.get(e.id) ?? null,
});

export async function listActivity(caller: LedgerCaller, q: Query) {
	const page = await (await trpcAuditLog(caller)).projectActivityFeed({
		projectId: q.id,
		cursor: q.cursor,
		limit: q.limit,
		filters: filtersOf(q),
	});
	const changes = await changesOf(page.entries.map((e) => e.id));
	return {
		items: page.entries.map((e) => entryOf(e as Entry, changes)),
		nextCursor: page.nextCursor,
		totalCount: page.totalCount,
	};
}

export async function readActivityFilters(caller: LedgerCaller, id: string) {
	return (await trpcAuditLog(caller)).projectActivityFilters({ projectId: id });
}

export async function readLastActivity(caller: LedgerCaller, ids: string) {
	const last = await (await trpcAuditLog(caller)).projectsLastActivity({
		projectIds: idList(ids, MAX_LAST_ACTIVITY_IDS),
	});
	const entries = Object.entries(last);
	const changes = await changesOf(entries.map(([, e]) => e.id));
	return {
		items: entries.map(([projectId, entry]) => ({
			projectId,
			entry: entryOf(entry as Entry, changes),
		})),
	};
}

export async function readExpenseHistory(caller: LedgerCaller, id: string) {
	const history = await (await trpcAuditLog(caller)).transactionHistory({
		transactionId: id,
	});
	const { transaction: info } = history;
	// The router formats the amount for display; the figure itself is read here.
	const live = info.isDeleted
		? null
		: await caller.db.sharedTransaction.findUnique({
				where: { id },
				select: { amount: true },
			});
	const changes = await changesOf(history.entries.map((e) => e.id));
	return {
		expense: {
			id: info.id,
			title: info.description,
			amount: live
				? {
						minor: toMinor(live.amount.toString(), info.currency),
						currency: info.currency,
					}
				: null,
			currency: info.currency,
			isDeleted: info.isDeleted,
			isLocked: info.isLocked,
		},
		entries: history.entries.map((e) => ({
			id: e.id,
			timestamp: e.timestamp,
			actor: e.actor,
			action: { type: e.action.type, label: e.action.label },
			summary: e.summary,
			changes: changes.get(e.id) ?? null,
		})),
		totalEntries: history.totalEntries,
	};
}

export async function readRevisions(caller: LedgerCaller, ids: string) {
	const summary = await (await trpcAuditLog(caller)).transactionRevisionSummary({
		transactionIds: idList(ids, MAX_REVISION_IDS),
	});
	return {
		items: Object.entries(summary).map(([expenseId, s]) => ({
			expenseId,
			editCount: s.editCount,
			lastEditedAt: s.lastEditedAt,
			lastEditedBy: s.lastEditedBy,
		})),
	};
}

export async function markSeen(caller: LedgerCaller, id: string) {
	await (await trpcAuditLog(caller)).markTransactionSeen({ transactionId: id });
	return { ok: true as const };
}
