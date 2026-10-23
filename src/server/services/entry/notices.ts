/**
 * Taking back what a shared expense's create told people, when its Undo
 * runs right away: the "split with you" notices go, and no "deleted" notice
 * follows, so the people on it see nothing happen instead of two events.
 * Runs after the delete commits, like every notification.
 */
import { db } from "~/server/db";

/** How long after creating an expense its Undo may take the notices back. */
export const RETRACT_WINDOW_MS = 15 * 60_000;

export async function retractSplitNotices(
	transactionId: string,
): Promise<void> {
	await db.notification.deleteMany({
		where: {
			type: "EXPENSE_SPLIT",
			data: { path: ["transactionId"], equals: transactionId },
		},
	});
}
