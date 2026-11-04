import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "~prisma";

/**
 * The admin access log: every time an admin acts on a person's account, one
 * row says what, and the person reads it in Settings. The codes are stable and
 * carry no text from the account (no names, titles or amounts).
 */
export const ADMIN_ACCESS_ACTIONS = [
	"password_reset",
	"reset_link",
	"disabled",
	"enabled",
	"email_verified",
	"email_verification_changed",
	"ai_access_changed",
	"avatar_removed",
] as const;

export type AdminAccessAction = (typeof ADMIN_ACCESS_ACTIONS)[number];

/**
 * Records an admin acting on a person's account. Call it before the action:
 * if the log cannot be written the action does not happen. Needs the global
 * connection (the app role has no write on this table). A missing person is a
 * NOT_FOUND, not a database error.
 */
export async function recordAdminAccess(
	db: PrismaClient,
	params: { adminId: string; userId: string; action: AdminAccessAction },
): Promise<void> {
	try {
		await db.adminAccessLog.create({
			data: {
				userId: params.userId,
				adminId: params.adminId,
				action: params.action,
			},
		});
	} catch (error) {
		if ((error as { code?: string }).code === "P2003") {
			throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
		}
		throw error;
	}
}

/** The admin procedures that act on one person's account, and what each is logged as. */
const ACTION_BY_PROCEDURE: Record<string, AdminAccessAction> = {
	resetPassword: "password_reset",
	generatePasswordResetLink: "reset_link",
	disableUser: "disabled",
	enableUser: "enabled",
	markEmailVerified: "email_verified",
	toggleEmailVerification: "email_verification_changed",
	setUserAiAccess: "ai_access_changed",
	removeUserAvatar: "avatar_removed",
};

/**
 * The one hook for the log: adminProcedure calls it before every admin
 * procedure runs. A procedure not in the table above, or one without a
 * `userId` in its input, is not an action on an account and logs nothing.
 * Throws when the row cannot be written, so the action does not happen.
 */
export async function logAdminProcedure(
	db: PrismaClient,
	call: { path: string; adminId: string; rawInput: unknown },
): Promise<void> {
	const name = call.path.replace(/^admin\./, "");
	const action = Object.hasOwn(ACTION_BY_PROCEDURE, name)
		? ACTION_BY_PROCEDURE[name]
		: undefined;
	const userId = (call.rawInput as { userId?: unknown } | null)?.userId;
	if (!action || typeof userId !== "string" || userId === "") return;
	await recordAdminAccess(db, { adminId: call.adminId, userId, action });
}

/** The person's own entries, newest first. Pass a user-scoped client. */
export async function listOwnAdminAccess(db: PrismaClient, limit = 50) {
	const rows = await db.adminAccessLog.findMany({
		select: { id: true, action: true, createdAt: true },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: limit,
	});
	return rows.map((r) => ({
		id: r.id,
		action: r.action as AdminAccessAction,
		createdAt: r.createdAt,
	}));
}
