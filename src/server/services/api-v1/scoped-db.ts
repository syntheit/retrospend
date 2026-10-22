import { createUserScopedDb } from "~/server/db";

/**
 * The Prisma client a v1 request runs on: the same user-scoped client
 * protectedProcedure builds for tRPC, so RLS applies identically. Lives in
 * services because transport files may not import ~/server/db (UI-151).
 */
export function scopedDbFor(userId: string) {
	return createUserScopedDb(userId);
}
