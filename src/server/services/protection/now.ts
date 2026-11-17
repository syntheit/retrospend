import { db } from "~/server/db";
import { isProtected } from "~/server/api/protection/guard";

/**
 * Whether the account is protected right now, for work that runs outside a
 * request (recurring auto-post, the import queue, export builds, auto-finalize).
 * It reads the state on the owner client on purpose: those workers run as
 * `retrospend_app`, which has no grant on `protectionState` and must not get
 * one, and the user-scoped client refuses raw SQL. A missing user counts as
 * protected, like a missing state in `isProtected`. Call it again before each
 * write step: the state can flip while a job runs (K9 drains in-flight work).
 */
export async function isProtectedNow(userId: string): Promise<boolean> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { protectionState: true },
	});
	return isProtected(user?.protectionState);
}
