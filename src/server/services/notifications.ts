import { env } from "~/env";
import { signUnsubscribeToken } from "~/lib/unsubscribe-token";
import { db } from "~/server/db";
import { notificationEmail } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import { InvalidCursorError } from "~/server/services/api-v1/cursor";
import type { NotificationType } from "~prisma";

// Default email-on preferences for types that should email by default
const EMAIL_ON_BY_DEFAULT = new Set<NotificationType>([
	"VERIFICATION_REQUEST",
	"PERIOD_CLOSED",
	"PARTICIPANT_ADDED",
	"EXPENSE_SPLIT",
	"SETTLEMENT_RECEIVED",
	"SETTLEMENT_CONFIRMED",
	"EXPENSE_EDITED",
	"EXPENSE_DELETED",
	"PAYMENT_REMINDER",
	"SETTLEMENT_REJECTED",
]);

interface CreateNotificationParams {
	userId: string;
	type: NotificationType;
	title: string;
	body: string;
	data?: Record<string, unknown>;
}

/**
 * Creates an in-app notification for a user and optionally sends an email.
 * Uses the global (superuser) db so it can write notifications for any userId
 * regardless of the calling context's RLS scope.
 *
 * Safe to call fire-and-forget: all errors are caught and logged.
 */
export async function createNotification(
	params: CreateNotificationParams,
): Promise<void> {
	const { userId, type, title, body, data } = params;

	try {
		// Look up the user's preference for this notification type
		const pref = await db.notificationPreference.findUnique({
			where: { userId_type: { userId, type } },
		});

		// Defaults if no preference row exists yet
		const inApp = pref?.inApp ?? true;
		const emailEnabled = pref?.email ?? EMAIL_ON_BY_DEFAULT.has(type);
		const digestMode = pref?.digestMode ?? false;

		if (inApp) {
			await db.notification.create({
				data: {
					userId,
					type,
					title,
					body,
					// JSON.parse(JSON.stringify(data)) ensures a pure JSON value for Prisma
					...(data ? { data: JSON.parse(JSON.stringify(data)) as object } : {}),
				},
			});
		}

		if (emailEnabled && !digestMode) {
			const user = await db.user.findUnique({
				where: { id: userId },
				select: { email: true },
			});
			if (user?.email) {
				const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
				const secret = env.UNSUBSCRIBE_SECRET;

				let unsubscribeUrl: string | undefined;
				let extraHeaders: Record<string, string> | undefined;

				if (secret && appUrl) {
					const token = signUnsubscribeToken(userId, type, secret);
					unsubscribeUrl = `${appUrl}/unsubscribe?token=${token}&userId=${encodeURIComponent(userId)}&type=${encodeURIComponent(type)}`;
					extraHeaders = {
						"List-Unsubscribe": `<${unsubscribeUrl}>`,
						"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
					};
				}

				const html = notificationEmail({ title, body, unsubscribeUrl });
				await sendEmail(
					user.email,
					`Retrospend: ${title}`,
					html,
					false,
					extraHeaders,
				);
			}
		}
	} catch (err) {
		console.error("[Notification Error] Failed to create notification:", err);
	}
}

/**
 * Resolves a participant's display name from the database.
 * Returns "Someone" if the participant cannot be found.
 */
export async function resolveParticipantName(
	participantType: string,
	participantId: string,
): Promise<string> {
	if (participantId === "DELETED_USER") return "Deleted User";
	if (participantId === "DELETED_GUEST") return "Deleted Guest";
	try {
		if (participantType === "user") {
			const user = await db.user.findUnique({
				where: { id: participantId },
				select: { name: true },
			});
			return user?.name ?? "Someone";
		}
		if (participantType === "shadow") {
			const shadow = await db.shadowProfile.findUnique({
				where: { id: participantId },
				select: { name: true },
			});
			return shadow?.name ?? "Someone";
		}
		// guest
		const guest = await db.guestSession.findUnique({
			where: { id: participantId },
			select: { name: true },
		});
		return guest?.name ?? "Someone";
	} catch {
		return "Someone";
	}
}

// ---- the caller's own notifications (tRPC notification router, /api/v1) ----

type UserDb = typeof db;

export const NOTIFICATION_TYPES: NotificationType[] = [
	"EXPENSE_SPLIT",
	"VERIFICATION_REQUEST",
	"EXPENSE_EDITED",
	"EXPENSE_DELETED",
	"SETTLEMENT_RECEIVED",
	"SETTLEMENT_CONFIRMED",
	"SETTLEMENT_REJECTED",
	"PERIOD_CLOSED",
	"PARTICIPANT_ADDED",
	"PAYMENT_REMINDER",
	"RECURRING_DUE",
];

/**
 * Email defaults written when a user first opens their preferences. These
 * differ from EMAIL_ON_BY_DEFAULT above, which only applies while no row
 * exists yet; kept as they were so stored preferences do not change.
 */
const PREFERENCE_EMAIL_DEFAULTS = new Set<NotificationType>([
	"VERIFICATION_REQUEST",
	"PERIOD_CLOSED",
]);

/**
 * A page of notifications, newest first (ties by id). `afterId` is the
 * last notification of the previous page; one that is gone or not the
 * caller's is an InvalidCursorError, never a restart from the top (which
 * would hand the client rows it already has).
 */
export async function listNotifications(
	userDb: UserDb,
	userId: string,
	page: { unreadOnly: boolean; take: number; afterId?: string },
) {
	const after = page.afterId
		? await userDb.notification.findFirst({
				where: { id: page.afterId, userId },
				select: { id: true, createdAt: true },
			})
		: null;
	if (page.afterId && !after) throw new InvalidCursorError();
	return userDb.notification.findMany({
		where: {
			userId,
			...(page.unreadOnly ? { isRead: false } : {}),
			...(after
				? {
						OR: [
							{ createdAt: { lt: after.createdAt } },
							{ createdAt: after.createdAt, id: { lt: after.id } },
						],
					}
				: {}),
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: page.take,
	});
}

export function countUnreadNotifications(userDb: UserDb, userId: string) {
	return userDb.notification.count({ where: { userId, isRead: false } });
}

/** Marks one notification read; false when the caller has no such notification. */
export async function markNotificationRead(
	userDb: UserDb,
	userId: string,
	id: string,
): Promise<boolean> {
	const found = await userDb.notification.findFirst({
		where: { id, userId },
		select: { id: true },
	});
	if (!found) return false;
	await userDb.notification.updateMany({
		where: { id, userId },
		data: { isRead: true },
	});
	return true;
}

/** Marks every unread notification read and says how many changed. */
export async function markAllNotificationsRead(
	userDb: UserDb,
	userId: string,
): Promise<number> {
	const { count } = await userDb.notification.updateMany({
		where: { userId, isRead: false },
		data: { isRead: true },
	});
	return count;
}

/** One row per type, creating the missing ones with their defaults. */
export async function getNotificationPreferences(
	userDb: UserDb,
	userId: string,
) {
	const existing = await userDb.notificationPreference.findMany({
		where: { userId },
		select: { type: true },
	});
	const have = new Set(existing.map((p) => p.type));
	const missing = NOTIFICATION_TYPES.filter((t) => !have.has(t));
	if (missing.length > 0) {
		await userDb.notificationPreference.createMany({
			data: missing.map((type) => ({
				userId,
				type,
				inApp: true,
				push: true,
				email: PREFERENCE_EMAIL_DEFAULTS.has(type),
				digestMode: false,
			})),
			skipDuplicates: true,
		});
	}
	return userDb.notificationPreference.findMany({
		where: { userId },
		orderBy: { type: "asc" },
	});
}

export async function updateNotificationPreferences(
	userDb: UserDb,
	userId: string,
	preferences: {
		type: NotificationType;
		inApp: boolean;
		/** Left out: unchanged on an existing row, the in-app value for a new one. */
		push?: boolean;
		email: boolean;
		digestMode: boolean;
	}[],
) {
	for (const { push, ...pref } of preferences) {
		await userDb.notificationPreference.upsert({
			where: { userId_type: { userId, type: pref.type } },
			// A new row starts push as the in-app switch says, the rule the
			// push_preference migration used for existing rows.
			create: { userId, ...pref, push: push ?? pref.inApp },
			update: {
				inApp: pref.inApp,
				email: pref.email,
				digestMode: pref.digestMode,
				...(push !== undefined && { push }),
			},
		});
	}
}
