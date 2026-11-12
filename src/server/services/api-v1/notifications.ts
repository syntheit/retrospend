import type { CursorQuery } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
	countUnreadNotifications,
	getNotificationPreferences,
	listNotifications,
	loadNoticeReader,
	markAllNotificationsRead,
	markNotificationRead,
	presentNotifications,
	updateNotificationPreferences,
} from "~/server/services/notifications";
import type { NotificationType } from "~prisma";
import type { Caller } from "./caller";
import { decodeCursor, toPage } from "./cursor";

/** v1 adapters for /notifications. */

const idCursor = z.object({ id: z.string() });

function dataOf(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export async function listNotificationPage(
	caller: Caller,
	q: CursorQuery & { unreadOnly?: "true" | "false" },
) {
	const after = decodeCursor(q.cursor, idCursor);
	const { userId } = caller.principal;
	const found = await listNotifications(caller.db, userId, {
		unreadOnly: q.unreadOnly === "true",
		take: q.limit + 1,
		afterId: after?.id,
	});
	const rows = await presentNotifications(
		found,
		await loadNoticeReader(caller.db, userId),
	);
	return toPage(
		rows,
		q.limit,
		(n) => ({ id: n.id }),
		(n) => ({
			id: n.id,
			type: n.type,
			title: n.title,
			body: n.body,
			data: dataOf(n.data),
			isRead: n.isRead,
			createdAt: n.createdAt.toISOString(),
		}),
	);
}

export async function unreadCount(caller: Caller) {
	return {
		count: await countUnreadNotifications(caller.db, caller.principal.userId),
	};
}

export async function readOne(caller: Caller, id: string) {
	const found = await markNotificationRead(
		caller.db,
		caller.principal.userId,
		id,
	);
	if (!found) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Notification not found",
		});
	}
	return { ok: true as const };
}

export async function readAll(caller: Caller) {
	return {
		count: await markAllNotificationsRead(caller.db, caller.principal.userId),
	};
}

async function preferences(caller: Caller) {
	const rows = await getNotificationPreferences(
		caller.db,
		caller.principal.userId,
	);
	return {
		preferences: rows.map((p) => ({
			type: p.type,
			inApp: p.inApp,
			push: p.push,
			email: p.email,
			digestMode: p.digestMode,
		})),
	};
}

export const readPreferences = preferences;

export async function writePreferences(
	caller: Caller,
	prefs: {
		type: NotificationType;
		inApp: boolean;
		push?: boolean;
		email: boolean;
		digestMode: boolean;
	}[],
) {
	await updateNotificationPreferences(
		caller.db,
		caller.principal.userId,
		prefs,
	);
	return preferences(caller);
}
