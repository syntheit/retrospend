import { dayKey } from "@retrospend/domain/time-zone";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { Prisma, PrismaClient } from "~prisma";
import { fromIsoDate } from "./membership";

/**
 * The join date to store for someone added to a project without one (RC-11).
 * On the project's first day, people are founders and get null ("from the
 * start"); after that, today in the acting user's zone. When an expense
 * brought them in (`onDay`), never later than that expense's day, so they
 * are a member on every expense they are part of.
 *
 * Every way into a project uses this: Add person, invite links, and ghosts
 * added by splitting an expense with them.
 */
export async function defaultJoinedOn(
	db: PrismaClient | Prisma.TransactionClient,
	projectId: string,
	actorUserId: string | null,
	options: { onDay?: Date; now?: Date } = {},
): Promise<Date | null> {
	const project = await (db as PrismaClient).project.findUnique({
		where: { id: projectId },
		select: { createdAt: true },
	});
	if (!project) return null;
	const zone = await userTimeZone(db, actorUserId);
	const today = dayKey(options.now ?? new Date(), zone);
	if (today === dayKey(project.createdAt, zone)) return null;
	const expenseDay = options.onDay ? dayKey(options.onDay, zone) : today;
	return fromIsoDate(expenseDay < today ? expenseDay : today);
}
