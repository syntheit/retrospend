/**
 * The self-service delete, shared by the web (user.deleteAccount) and
 * /api/v1 (POST /me/deletion).
 */
import { TRPCError } from "@trpc/server";
import { verifyPassword } from "better-auth/crypto";
import type { PrismaClient } from "~prisma";
import { anonymizeAndDeleteUser } from "./user-deletion.service";

/**
 * An admin is refused (the server could be left with none; the
 * last-admin guard inside anonymizeAndDeleteUser holds the same line under
 * a race), then the account password is checked, then the account goes.
 * Re-authentication is the password, so an account with none (social
 * sign-in only) cannot be deleted here.
 */
export async function deleteOwnAccount(
	db: PrismaClient,
	user: { id: string; role: string; email?: string },
	password: string,
): Promise<void> {
	if (user.role === "ADMIN") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Admins cannot delete their own account",
		});
	}

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
	await anonymizeAndDeleteUser(
		db,
		user.id,
		row?.email ?? user.email ?? "",
		row?.avatarPath ?? null,
	);
}
