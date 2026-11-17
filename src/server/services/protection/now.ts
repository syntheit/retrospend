import { db } from "~/server/db";
import type { Prisma } from "~prisma";
import { isProtected } from "@retrospend/api-contract/protection-state";

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

/**
 * The ids among `userIds` whose account is unprotected (an explicit OFF), for
 * a batch worker that decides per event owner. Pass the owner transaction the
 * worker already holds: the state is not readable from the user-scoped client.
 * An id with no user row is left out, so a missing user is protected, and a
 * failed read throws and rolls the batch back, so nothing goes out.
 */
export async function unprotectedAmong(
	tx: Prisma.TransactionClient,
	userIds: readonly string[],
): Promise<Set<string>> {
	const rows = await tx.user.findMany({
		where: { id: { in: [...new Set(userIds)] } },
		select: { id: true, protectionState: true },
	});
	return new Set(
		rows.filter((r) => !isProtected(r.protectionState)).map((r) => r.id),
	);
}
