import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";

/**
 * The server must always keep an active admin. Disabling or deleting an
 * account (the web admin and /api/v1/admin both end here) first locks the
 * active admin rows, so two admins acting on each other at the same time
 * queue up: the second sees the first's result, and the last active admin
 * is refused.
 */
export async function assertAnotherAdminRemains(
	tx: Prisma.TransactionClient,
	targetUserId: string,
): Promise<void> {
	const admins = await tx.$queryRaw<{ id: string }[]>`
		SELECT "id" FROM "user"
		WHERE "role" = 'ADMIN' AND "isActive" = true
		ORDER BY "id"
		FOR UPDATE
	`;
	const others = admins.filter((a) => a.id !== targetUserId);
	if (admins.some((a) => a.id === targetUserId) && others.length === 0) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "The last active admin cannot be disabled or deleted",
		});
	}
}
