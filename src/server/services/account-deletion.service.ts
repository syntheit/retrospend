/**
 * The self-service delete, shared by the web (user.deleteAccount) and
 * /api/v1 (POST /me/deletion).
 */
import { TRPCError } from "@trpc/server";
import { verifyPassword } from "better-auth/crypto";
import { db } from "~/server/db";
import { isOnlyActiveAdmin, LastAdminError } from "./admin-guard.service";
import { consumeRateLimit } from "./api-v1/rate-limit.service";
import {
	anonymizeAndDeleteUser,
	previewAccountDeletion,
} from "./user-deletion.service";

/**
 * What deleting the account would change for other people. Read on the global
 * client, like the delete it previews: other people's rows are part of it.
 */
export const previewOwnAccountDeletion = (userId: string) =>
	previewAccountDeletion(db, userId);

/** Shown on the web and returned by /api/v1 when the last admin tries to leave. */
export const ONLY_ADMIN_MESSAGE =
	"You're the only admin. Make someone else an admin first, then you can delete your account.";

const onlyAdminError = () =>
	new TRPCError({ code: "FORBIDDEN", message: ONLY_ADMIN_MESSAGE });

/** Whether deleting this account would leave the server without an admin. */
export const isLastAdminAccount = (user: { id: string; role: string }) =>
	user.role === "ADMIN" ? isOnlyActiveAdmin(db, user.id) : false;

/** Wrong passwords are the one thing a stolen session can try here, so every try is counted. */
const TRIES = { limit: 5, windowMs: 15 * 60_000 } as const;

/** The caller has used their tries; `retryAfterSeconds` says when to come back. */
export class DeleteTriesExceededError extends TRPCError {
	constructor(readonly retryAfterSeconds: number) {
		super({
			code: "TOO_MANY_REQUESTS",
			message: "Too many tries. Try again later.",
		});
	}
}

/**
 * Deletes the account of an already-authenticated caller. The last active
 * admin is refused before anything else (the server could be left with none;
 * the locked guard inside anonymizeAndDeleteUser holds the same line under a
 * race); another admin may delete their own account. Then the tries are
 * counted (5 in 15 minutes per user), then the account password is checked,
 * then the account goes. Re-authentication is the password, so an account
 * with none (social sign-in only) cannot be deleted here.
 *
 * It runs on the global client, never a user-scoped one: the deletion
 * rewrites other people's rows, which row-level security would hide. Who may
 * delete was decided above; nothing below widens it.
 */
export async function deleteOwnAccount(
	user: { id: string; role: string; email?: string },
	password: string,
): Promise<void> {
	if (await isLastAdminAccount(user)) throw onlyAdminError();

	const tries = await consumeRateLimit(
		`acctdel:${user.id}`,
		TRIES.limit,
		TRIES.windowMs,
	);
	if (!tries.allowed)
		throw new DeleteTriesExceededError(tries.retryAfterSeconds);

	const credentialAccount = await db.account.findFirst({
		where: { userId: user.id, providerId: "credential" },
	});
	if (!credentialAccount?.password) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Cannot verify identity for this account type",
		});
	}
	const isValid = await verifyPassword({
		password,
		hash: credentialAccount.password,
	});
	if (!isValid) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Incorrect password",
		});
	}

	const row = await db.user.findUnique({
		where: { id: user.id },
		select: { email: true, avatarPath: true },
	});
	try {
		await anonymizeAndDeleteUser(
			db,
			user.id,
			row?.email ?? user.email ?? "",
			row?.avatarPath ?? null,
		);
	} catch (error) {
		// Another admin was disabled or deleted since the check above.
		if (error instanceof LastAdminError) throw onlyAdminError();
		throw error;
	}
}
