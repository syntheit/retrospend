import { env } from "~/env";
import { db } from "~/server/db";
import { notificationEmail } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import { signUnsubscribeToken } from "~/lib/unsubscribe-token";
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
				await sendEmail(user.email, `Retrospend: ${title}`, html, false, extraHeaders);
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
