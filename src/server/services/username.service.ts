import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "~prisma";
import { logEventAsync } from "~/server/services/audit.service";

/** Users can change their username at most once every 30 days. */
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

/** Old usernames are reserved (cannot be taken by others) for 90 days. */
export const USERNAME_RESERVATION_DAYS = 90;

/**
 * Validates a username change and records the old username in history.
 * Must be called *before* `db.user.update()` - it does NOT update the user record itself.
 *
 * @throws TRPCError TOO_MANY_REQUESTS  if cooldown hasn't elapsed
 * @throws TRPCError CONFLICT           if new username is taken by another user or reserved
 */
export async function validateAndProcessUsernameChange(
	db: PrismaClient,
	userId: string,
	currentUsername: string,
	newUsername: string,
): Promise<void> {
	// 1. Check cooldown
	const user = await db.user.findUniqueOrThrow({
		where: { id: userId },
		select: { lastUsernameChangeAt: true },
	});

	if (user.lastUsernameChangeAt) {
		const cooldownEnd = new Date(user.lastUsernameChangeAt);
		cooldownEnd.setDate(cooldownEnd.getDate() + USERNAME_CHANGE_COOLDOWN_DAYS);

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

	// 2. Check new username isn't taken by another user
	const existingUser = await db.user.findUnique({
		where: { username: newUsername },
	});
	if (existingUser && existingUser.id !== userId) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Username is already taken",
		});
	}

	// 3. Check new username isn't reserved in history by another user (within 90 days)
	const reservationCutoff = new Date();
	reservationCutoff.setDate(
		reservationCutoff.getDate() - USERNAME_RESERVATION_DAYS,
	);

	const reservedEntry = await db.usernameHistory.findUnique({
		where: { previousUsername: newUsername },
		select: { userId: true, changedAt: true },
	});

	if (reservedEntry) {
		if (
			reservedEntry.userId === userId
		) {
			// User is reclaiming their own old username - remove the history record
			await db.usernameHistory.delete({
				where: { previousUsername: newUsername },
			});
		} else if (reservedEntry.changedAt > reservationCutoff) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "Username is not available",
			});
		} else {
			// Reservation expired - clean it up
			await db.usernameHistory.delete({
				where: { previousUsername: newUsername },
			});
		}
	}

	// 4. Record old username in history + set cooldown timestamp (in a transaction)
	//    Delete any stale history entry for currentUsername first - this can exist if
	//    another user previously held this username, changed away, and the reservation expired.
	await db.$transaction([
		db.usernameHistory.deleteMany({
			where: { previousUsername: currentUsername },
		}),
		db.usernameHistory.create({
			data: {
				userId,
				previousUsername: currentUsername,
			},
		}),
		db.user.update({
			where: { id: userId },
			data: { lastUsernameChangeAt: new Date() },
		}),
	]);

	// 5. Fire audit log event
	logEventAsync({
		eventType: "USERNAME_CHANGED",
		userId,
		metadata: {
			previousUsername: currentUsername,
			newUsername,
		},
	});
}
