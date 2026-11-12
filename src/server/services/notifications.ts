import { env } from "~/env";
import { signUnsubscribeToken } from "~/lib/unsubscribe-token";
import { db } from "~/server/db";
import { renderNoticeEmail } from "~/server/services/notice-email";
import { sendEmail } from "~/server/mailer";
import {
	type ActorRef,
	buildNoticeText,
	NOTICE_DATA_KEYS,
	type Notice,
	type NoticeData,
	type NoticeReader,
	parseStoredNotice,
} from "~/server/services/notification-text";
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

export interface CreateNotificationParams {
	userId: string;
	type: NotificationType;
	/**
	 * What happened. It is stored as ids, codes and minor amounts, and the
	 * in-app text is made from it when the notification is read
	 * (presentNotifications); the email text is made here, at send time.
	 */
	notice: Notice;
	/** Ids the app opens the notification by. No names or free text. */
	data?: NoticeData;
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
	const { userId, type, data } = params;
	// The stored notice is the one read back: the same schema at both ends,
	// so a row never reads blank, and a key a caller adds is never stored.
	const notice = parseStoredNotice(params.notice);
	if (!notice) {
		console.error("[Notification Error] Refused a notice that does not match its schema:", type);
		return;
	}

	try {
		// Look up the user's preference for this notification type
		const pref = await db.notificationPreference.findUnique({
			where: { userId_type: { userId, type } },
		});

		// Defaults if no preference row exists yet
		const inApp = pref?.inApp ?? true;
		const emailEnabled = pref?.email ?? EMAIL_ON_BY_DEFAULT.has(type);
		const digestMode = pref?.digestMode ?? false;

		const user = await db.user.findUnique({
			where: { id: userId },
			select: { email: true, language: true, numberFormat: true },
		});
		// Only the listed ids, whatever a caller handed over, and the notice
		// itself: no name and no sentence is stored. The columns stay NOT NULL
		// and hold "", so a server that reads them older than this one shows
		// blank text instead of failing.
		const stored = {
			...Object.fromEntries(
				Object.entries(data ?? {}).filter(([key]) => NOTICE_DATA_KEYS.has(key)),
			),
			notice,
		};

		if (inApp) {
			await db.notification.create({
				data: {
					userId,
					type,
					title: "",
					body: "",
					// JSON.parse(JSON.stringify(...)) ensures a pure JSON value for Prisma
					data: JSON.parse(JSON.stringify(stored)) as object,
				},
			});
		}

		if (emailEnabled && !digestMode) {
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

				const actorName = notice.actor
					? await resolveParticipantName(notice.actor.type, notice.actor.id)
					: null;
				const text = await buildNoticeText(notice, user, actorName);
				const email = await renderNoticeEmail(text, user, { unsubscribeUrl });
				await sendEmail(
					user.email,
					email.subject,
					email.html,
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
 * A participant's display name, or null when they are gone or cannot be
 * found (the notice then reads "Someone").
 */
export async function resolveParticipantName(
	participantType: string,
	participantId: string,
): Promise<string | null> {
	if (participantId === "DELETED_USER" || participantId === "DELETED_GUEST")
		return null;
	try {
		if (participantType === "user") {
			const user = await db.user.findUnique({
				where: { id: participantId },
				select: { name: true },
			});
			return user?.name ?? null;
		}
		if (participantType === "shadow") {
			const shadow = await db.shadowProfile.findUnique({
				where: { id: participantId },
				select: { name: true },
			});
			return shadow?.name ?? null;
		}
		// guest
		const guest = await db.guestSession.findUnique({
			where: { id: participantId },
			select: { name: true },
		});
		return guest?.name ?? null;
	} catch {
		return null;
	}
}

/**
 * The same name for a sentence in an error, where English words stand in
 * for a person who is gone or cannot be found.
 */
export async function participantLabel(
	participantType: string,
	participantId: string,
): Promise<string> {
	if (participantId === "DELETED_USER") return "Deleted User";
	if (participantId === "DELETED_GUEST") return "Deleted Guest";
	return (
		(await resolveParticipantName(participantType, participantId)) ?? "Someone"
	);
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

/** The language and number format the reader sees text in right now. */
export async function loadNoticeReader(
	userDb: UserDb,
	userId: string,
): Promise<NoticeReader> {
	const user = await userDb.user.findUnique({
		where: { id: userId },
		select: { language: true, numberFormat: true },
	});
	return user ?? {};
}

/** Display names by "type:id". A missing key is a person who is gone. */
async function loadActorNames(
	actors: readonly ActorRef[],
): Promise<Map<string, string>> {
	const ids = (type: ActorRef["type"]) => [
		...new Set(
			actors
				.filter(
					(a) =>
						a.type === type &&
						a.id !== "DELETED_USER" &&
						a.id !== "DELETED_GUEST",
				)
				.map((a) => a.id),
		),
	];
	const [userIds, shadowIds, guestIds] = [
		ids("user"),
		ids("shadow"),
		ids("guest"),
	];
	const [users, shadows, guests] = await Promise.all([
		userIds.length > 0
			? db.user.findMany({
					where: { id: { in: userIds } },
					select: { id: true, name: true },
				})
			: [],
		shadowIds.length > 0
			? db.shadowProfile.findMany({
					where: { id: { in: shadowIds } },
					select: { id: true, name: true },
				})
			: [],
		guestIds.length > 0
			? db.guestSession.findMany({
					where: { id: { in: guestIds } },
					select: { id: true, name: true },
				})
			: [],
	]);
	const names = new Map<string, string>();
	for (const [type, rows] of [
		["user", users],
		["shadow", shadows],
		["guest", guests],
	] as const)
		for (const row of rows) if (row.name) names.set(`${type}:${row.id}`, row.name);
	return names;
}

/**
 * Notification rows as the reader sees them. A row made by createNotification
 * keeps no text: its title and body are worded here, from `data.notice`, with
 * the actor's current name ("Someone" once that person is gone) in the
 * reader's current language and number format. The edit summary goes back
 * into `data.changes` and `data.notice` is not returned. A row from before
 * that (no `data.notice`) comes back as stored.
 */
export async function presentNotifications<
	T extends { title: string; body: string; data: unknown },
>(rows: T[], reader: NoticeReader): Promise<T[]> {
	const parsed = rows.map((row) => {
		const data =
			row.data && typeof row.data === "object" && !Array.isArray(row.data)
				? (row.data as Record<string, unknown>)
				: null;
		return { row, data, notice: parseStoredNotice(data?.notice) };
	});
	const actors = parsed.flatMap((p) => (p.notice?.actor ? [p.notice.actor] : []));
	const names =
		actors.length > 0 ? await loadActorNames(actors) : new Map<string, string>();
	return Promise.all(
		parsed.map(async ({ row, data, notice }) => {
			if (!notice || !data) {
				// A notice this server cannot read is never handed out raw.
				if (!data || !("notice" in data)) return row;
				const ids = { ...data };
				delete ids.notice;
				return { ...row, data: ids };
			}
			const text = await buildNoticeText(
				notice,
				reader,
				notice.actor ? (names.get(`${notice.actor.type}:${notice.actor.id}`) ?? null) : null,
			);
			const ids = { ...data };
			delete ids.notice;
			return {
				...row,
				title: text.title,
				body: text.body,
				data: text.changes ? { ...ids, changes: text.changes } : ids,
			};
		}),
	);
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
