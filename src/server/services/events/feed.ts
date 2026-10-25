import {
	type ApiEventDto,
	type EventData,
	eventDataSchema,
} from "@retrospend/api-contract";
import * as z from "zod";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { decodeCursor, encodeCursor } from "~/server/services/api-v1/cursor";
import { Prisma } from "~prisma";

/** The sort key of a feed row: the writing transaction, then the row's sequence. */
const feedCursorSchema = z.object({
	t: z.string().regex(/^\d{1,20}$/),
	s: z.string().regex(/^\d{1,20}$/),
});

export type FeedRow = {
	id: string;
	seq: string;
	txid: string;
	type: string;
	entityType: string | null;
	entityId: string | null;
	actorUserId: string | null;
	payload: unknown;
	createdAt: Date;
};

const EMPTY: EventData = { ids: {}, amounts: [], truncated: false };

export function toEventDto(row: FeedRow): ApiEventDto {
	const parsed = eventDataSchema.safeParse(row.payload);
	return {
		id: row.id,
		cursor: encodeCursor({ t: row.txid, s: row.seq }),
		type: row.type,
		occurredAt: row.createdAt.toISOString(),
		actorUserId: row.actorUserId,
		entity:
			row.entityType && row.entityId
				? { type: row.entityType, id: row.entityId }
				: null,
		data: parsed.success ? parsed.data : EMPTY,
	};
}

/**
 * The caller's events after `after`, oldest first. Order is commit order:
 * rows sort by (txid, seq) and a row is visible only once its txid is below
 * the oldest transaction still open, so one that commits late can never
 * appear behind a cursor a client already holds. The price is that an event
 * shows up when the slowest open transaction finishes (a preview, a long
 * import), normally a few milliseconds after its own commit.
 */
export async function readEventFeed(
	db: typeof globalDb,
	userId: string,
	query: { after?: string; limit: number },
) {
	const after = decodeCursor(query.after, feedCursorSchema);
	const rows = await userTransaction(db, userId, (tx) =>
		tx.$queryRaw<FeedRow[]>(Prisma.sql`
			SELECT "id", "seq"::text AS "seq", "txid"::text AS "txid", "type",
			       "entityType", "entityId", "actorUserId", "payload", "createdAt"
			FROM "api_event"
			WHERE "userId" = ${userId}
			  AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
			  ${
					after
						? Prisma.sql`AND ("txid", "seq") > (${after.t}::xid8, ${after.s}::bigint)`
						: Prisma.empty
				}
			ORDER BY "txid", "seq"
			LIMIT ${query.limit + 1}`),
	);
	const kept = rows.slice(0, query.limit);
	const items = kept.map(toEventDto);
	return {
		items,
		// Nothing new: hand back the cursor the caller already has.
		cursor: items.at(-1)?.cursor ?? query.after ?? null,
		hasMore: rows.length > query.limit,
	};
}
