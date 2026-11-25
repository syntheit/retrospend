import type { EVENT_LOG_TYPES } from "@retrospend/api-contract";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "~/server/services/api-v1/cursor";
import type { PrismaClient } from "~prisma";

type EventLogDb = Pick<PrismaClient, "eventLog">;

/**
 * Event log pages run newest first by time, then id, so rows sharing a time
 * are neither skipped nor repeated. The cursor is the key of the last row kept.
 */
const eventLogKey = z.object({ timestamp: z.iso.datetime(), id: z.string() });

export async function eventLogPage(
	db: EventLogDb,
	input: {
		limit: number;
		cursor?: string;
		eventType?: (typeof EVENT_LOG_TYPES)[number];
	},
) {
	const after = decodeCursor(input.cursor, eventLogKey);
	const rows = await db.eventLog.findMany({
		where: {
			...(input.eventType ? { eventType: input.eventType } : {}),
			...(after
				? {
						OR: [
							{ timestamp: { lt: new Date(after.timestamp) } },
							{
								timestamp: new Date(after.timestamp),
								id: { lt: after.id },
							},
						],
					}
				: {}),
		},
		include: { user: { select: { id: true, username: true, email: true } } },
		orderBy: [{ timestamp: "desc" }, { id: "desc" }],
		take: input.limit + 1,
	});
	const logs = rows.slice(0, input.limit);
	const last = logs.at(-1);
	const nextCursor =
		rows.length > input.limit && last
			? encodeCursor({
					timestamp: last.timestamp.toISOString(),
					id: last.id,
				})
			: undefined;
	return { logs, nextCursor };
}
