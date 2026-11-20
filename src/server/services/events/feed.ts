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

/**
 * The event types a protected account's feed may show besides the bare copies
 * of other people's shared writes (see `protectedFeedFilter`). Each one is
 * written by a route a protected account can call (V1_ALLOWED), and none
 * carries a personal id or an amount: the routes return no Money, and the
 * extractor keeps only id-shaped strings and Money, so the data is at most the
 * row's own id (a token, a push device, a session). `vault.changed` carries
 * sealed record ids only and is shown to the `vault` scope alone.
 *
 * Left out on purpose: every ledger, people, budget, wealth and settings type
 * (their data holds category, account and person ids and amounts), the
 * profile and notification preference types, and the admin types (they name
 * other accounts). Add a type only after reading what its route returns.
 *
 * Events a protected account wrote before turning protection on stay in the
 * table; the allowlist, not their absence, is what keeps them out of this
 * feed. K9's turn-on deletes the account's personal-resource rows.
 */
export const PROTECTED_FEED_TYPES: readonly string[] = [
	"vault.changed",
	"user.deleted",
	"user.password_changed",
	"user.protection_keys_created",
	"user.recovery_key_replaced",
	"user.session_ended",
	"token.created",
	"token.revoked",
	"push_device.registered",
	"push_device.removed",
];

/** What the caller may see; the transport decides it from the principal. */
export type FeedAccess = {
	/** The caller holds the `vault` scope: only then `vault.changed` shows. */
	includeVault: boolean;
	/** The account has advanced protection on (or an unknown state): allowlist only. */
	protectedAccount: boolean;
};

/** For callers that read as the owner of the feed (jobs, tests): nothing hidden. */
export const WHOLE_FEED: FeedAccess = {
	includeVault: true,
	protectedAccount: false,
};

/**
 * The rows a protected account may read: the allowlisted types, and a bare
 * copy of someone else's shared write (`sourceEventId` set, written by
 * audience.ts with no ids and no amounts, by another actor). The copy test
 * checks the payload as well, so a row that somehow carried data stays out.
 */
function protectedFeedFilter() {
	return Prisma.sql`AND ("type" IN (${Prisma.join(PROTECTED_FEED_TYPES)})
		OR ("sourceEventId" IS NOT NULL
			AND "actorUserId" IS DISTINCT FROM "userId"
			AND "payload"->'ids' = '{}'::jsonb
			AND "payload"->'amounts' = '[]'::jsonb))`;
}

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
 *
 * Both filters are in the WHERE clause, so LIMIT counts kept rows and a page
 * over a stretch of hidden rows still reaches the next visible one.
 */
export async function readEventFeed(
	db: typeof globalDb,
	userId: string,
	query: { after?: string; limit: number },
	access: FeedAccess,
) {
	const after = decodeCursor(query.after, feedCursorSchema);
	const rows = await userTransaction(db, userId, (tx) =>
		tx.$queryRaw<FeedRow[]>(Prisma.sql`
			SELECT "id", "seq"::text AS "seq", "txid"::text AS "txid", "type",
			       "entityType", "entityId", "actorUserId", "payload", "createdAt"
			FROM "api_event"
			WHERE "userId" = ${userId}
			  AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
			  ${access.includeVault ? Prisma.empty : Prisma.sql`AND "type" <> 'vault.changed'`}
			  ${access.protectedAccount ? protectedFeedFilter() : Prisma.empty}
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
