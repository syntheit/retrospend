import { TRPCError } from "@trpc/server";
import { db } from "~/server/db";
import { logEventAsync } from "~/server/services/audit.service";
import { Prisma } from "~prisma";

/** Users can change their username at most once every 30 days. */
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

/** Old usernames are reserved (cannot be taken by others) for 90 days. */
export const USERNAME_RESERVATION_DAYS = 90;

/**
 * Changes a user's username: checks the cooldown, the new name and its
 * reservations, records the old name in the history and writes the new one,
 * all in one transaction.
 *
 * Runs on the global (owner) client on purpose. A username change edits other
 * people's rows by design: it deletes a stale or expired reservation another
 * user left in username_history, and it reads every user's name to check the
 * new one is free. The app role has no access to username_history and may not
 * write `username` or `lastUsernameChangeAt`, so this is the only path. The
 * caller passes the signed-in user's own id; never an id from input.
 *
 * @throws TRPCError TOO_MANY_REQUESTS  if cooldown hasn't elapsed
 * @throws TRPCError CONFLICT           if the new username is taken by another user or reserved
 */
export async function changeUsername(
	userId: string,
	newUsername: string,
): Promise<void> {
	let previousUsername: string;
	try {
		previousUsername = await db.$transaction(async (tx) => {
			// Two changes at once for one user wait for each other.
			await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${userId} FOR UPDATE`;
			const user = await tx.user.findUniqueOrThrow({
				where: { id: userId },
				select: { username: true, lastUsernameChangeAt: true },
			});
			const currentUsername = user.username;

			// 1. Cooldown
			if (user.lastUsernameChangeAt) {
				const cooldownEnd = new Date(user.lastUsernameChangeAt);
				cooldownEnd.setDate(
					cooldownEnd.getDate() + USERNAME_CHANGE_COOLDOWN_DAYS,
				);
				if (new Date() < cooldownEnd) {
					const daysLeft = Math.ceil(
						(cooldownEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
					);
					throw new TRPCError({
						code: "TOO_MANY_REQUESTS",
						message: `You can change your username again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
					});
				}
			}

			// 2. The new username isn't taken by another user
			const existingUser = await tx.user.findUnique({
				where: { username: newUsername },
				select: { id: true },
			});
			if (existingUser && existingUser.id !== userId) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Username is already taken",
				});
			}

			// 3. The new username isn't reserved in history by another user (90 days)
			const reservationCutoff = new Date();
			reservationCutoff.setDate(
				reservationCutoff.getDate() - USERNAME_RESERVATION_DAYS,
			);
			const reservedEntry = await tx.usernameHistory.findUnique({
				where: { previousUsername: newUsername },
				select: { userId: true, changedAt: true },
			});
			if (reservedEntry) {
				if (
					reservedEntry.userId !== userId &&
					reservedEntry.changedAt > reservationCutoff
				) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Username is not available",
					});
				}
				// Reclaiming one's own old name, or a reservation that has expired:
				// the entry is removed.
				await tx.usernameHistory.delete({
					where: { previousUsername: newUsername },
				});
			}

			// 4. Record the old username and set the cooldown. A stale entry for the
			//    current name can exist if another user once held it, changed away
			//    and the reservation expired.
			await tx.usernameHistory.deleteMany({
				where: { previousUsername: currentUsername },
			});
			await tx.usernameHistory.create({
				data: { userId, previousUsername: currentUsername },
			});
			await tx.user.update({
				where: { id: userId },
				data: { username: newUsername, lastUsernameChangeAt: new Date() },
			});
			return currentUsername;
		});
	} catch (error) {
		// Someone took the name between the check and the write.
		if (
			error instanceof Prisma.PrismaClientKnownRequestError &&
			error.code === "P2002"
		) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "Username is already taken",
			});
		}
		throw error;
	}

	logEventAsync({
		eventType: "USERNAME_CHANGED",
		userId,
		metadata: { previousUsername, newUsername },
	});
}
