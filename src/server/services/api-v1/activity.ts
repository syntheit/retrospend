import {
	AUDIT_ACTIONS,
	MAX_LAST_ACTIVITY_IDS,
	MAX_REVISION_IDS,
} from "@retrospend/api-contract";
import type {
	activityDetailSchema,
	activityQuerySchema,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import { toMinor } from "~/server/services/envelope/units";
import type { LedgerCaller } from "./money-op";
import { trpcAuditLog } from "./trpc-bridge";

/**
 * v1 adapters for the activity feed and the expense history. The reads are
 * the auditLog procedures run in-process (the same membership rules); this
 * only drops the web's presentation fields (relative time, icon, colour) and
 * puts the lists in the v1 shapes.
 */

type Query = z.infer<typeof activityQuerySchema>;
type Detail = z.infer<typeof activityDetailSchema> | null;
type Action = (typeof AUDIT_ACTIONS)[number];

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
	summaryParams: Record<string, string> | null;
	target: { type: string; id: string; label: string | null };
	detail: Detail;
};

const entryOf = (e: Entry) => ({
	id: e.id,
	timestamp: e.timestamp,
	actor: e.actor,
	action: { type: e.action.type, label: e.action.label },
	summary: e.summary,
	summaryKey: e.summaryKey,
	summaryParams: e.summaryParams,
	target: e.target,
	detail: e.detail,
});

export async function listActivity(caller: LedgerCaller, q: Query) {
	const page = await (await trpcAuditLog(caller)).projectActivityFeed({
		projectId: q.id,
		cursor: q.cursor,
		limit: q.limit,
		filters: filtersOf(q),
	});
	return {
		items: page.entries.map((e) => entryOf(e as Entry)),
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
	return {
		items: Object.entries(last).map(([projectId, entry]) => ({
			projectId,
			entry: entryOf(entry as Entry),
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
			detail: e.detail as Detail,
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
