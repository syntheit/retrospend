import crypto from "node:crypto";
import {
	SealedTextError,
	stripUserTextControls,
	userText,
} from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import { verifyPassword } from "better-auth/crypto";
import { env } from "~/env";
import {
	type BackgroundSettings,
	backgroundSettingsSchema,
	defaultBackgroundSettings,
} from "~/lib/background-settings";
import { db as globalDb } from "~/server/db";
import { emailSubject } from "~/server/email-copy";
import {
	getEmailChangeAlertTemplate,
	getEmailChangeVerificationTemplate,
} from "~/server/email-templates";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { hashToken } from "~/server/lib/tokens";
import { sendEmail } from "~/server/mailer";
import { migrateGuestDataForVerifiedUser } from "~/server/services/guest-migration.service";
import { changeUsername } from "~/server/services/username.service";

type AppDb = typeof globalDb;

/**
 * The caller's profile: identity fields, the pending email change and the
 * public page background. One implementation for the tRPC profile router
 * and /api/v1/profile; callers pass a user-scoped client.
 */

export const PROFILE_SELECT = {
	id: true,
	name: true,
	username: true,
	email: true,
	image: true,
	avatarPath: true,
	pendingEmail: true,
	pendingEmailExpiresAt: true,
	createdAt: true,
} as const;

export async function getProfile(db: AppDb, userId: string) {
	const row = await db.user.findUnique({
		where: { id: userId },
		select: PROFILE_SELECT,
	});
	if (!row)
		throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
	return row;
}

const IDENTITY_SELECT = {
	id: true,
	name: true,
	username: true,
	email: true,
} as const;

/** What an update answers: the identity fields as stored now. */
export type UpdatedIdentity = {
	id: string;
	name: string;
	username: string;
	email: string;
};

/**
 * A name is user text, but Undo of a name change sends the previous stored
 * name back, and an old name may hold a control character. So the transports
 * take any string and the name is cleaned here: the characters userText
 * refuses are dropped, then it must pass userText.
 */
const nameText = userText("user.name", 100);

/**
 * The fields to change. A field left out keeps its stored value and is not
 * written, so a one-field save (or its Undo) never writes another field's
 * older value back.
 */
export interface ProfileChanges {
	name?: string;
	/** Lowercased before it is stored. */
	username?: string;
	/** Lowercased and trimmed before it is compared or stored. */
	email?: string;
	currentPassword?: string;
}

/** The identity column a change writes besides the email. */
type IdentityWrite = { name?: string };

// The password hash is auth data: the app role cannot read the account table,
// so it is read on the owner connection, for the caller's own id.
async function assertPassword(userId: string, password?: string) {
	if (!password) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Current password is required to change email",
		});
	}
	const credential = await globalDb.account.findFirst({
		where: { userId, providerId: "credential" },
	});
	if (!credential?.password) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Password verification is not available for this account",
		});
	}
	const valid = await verifyPassword({ password, hash: credential.password });
	if (!valid) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Current password is incorrect",
		});
	}
}

async function assertEmailFree(db: AppDb, userId: string, email: string) {
	const taken = await db.user.findFirst({
		where: {
			OR: [{ email }, { pendingEmail: email }],
			id: { not: userId },
		},
		select: { id: true },
	});
	if (taken) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Email is already in use",
		});
	}
}

/**
 * Starts the two-step email change: the new address gets a confirm link,
 * the old one a revert link. Emails go out in the background.
 */
async function startEmailChange(
	db: AppDb,
	user: { id: string; email: string },
	write: IdentityWrite,
	newEmail: string,
): Promise<UpdatedIdentity> {
	const token = crypto.randomBytes(32).toString("hex");
	const appUrl =
		env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997";
	const updated = await db.user.update({
		select: IDENTITY_SELECT,
		where: { id: user.id },
		data: {
			...write,
			pendingEmail: newEmail,
			pendingEmailToken: hashToken(token),
			pendingEmailExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
		},
	});
	sendEmail(
		newEmail,
		emailSubject.emailChangeConfirm,
		getEmailChangeVerificationTemplate(
			`${appUrl}/auth/confirm-email?token=${token}`,
			newEmail,
		),
	).catch((err) =>
		console.error("Failed to send email change verification:", err),
	);
	sendEmail(
		user.email,
		emailSubject.emailChangeAlert,
		getEmailChangeAlertTemplate(
			`${appUrl}/auth/revert-email?token=${token}`,
			newEmail,
		),
	).catch((err) => console.error("Failed to send email change alert:", err));
	return updated;
}

/**
 * Changes the given name, username and email. A new email needs the
 * current password; when the server can send email the change waits for
 * the new address to confirm it (`emailChangePending`), otherwise it
 * applies at once and picks up guest data for the address, as at sign-up.
 */
export async function updateProfile(
	db: AppDb,
	current: { id: string; username: string; email: string },
	input: ProfileChanges,
): Promise<{ emailChangePending: boolean; user: UpdatedIdentity }> {
	const userId = current.id;
	let name: string | undefined;
	try {
		name =
			input.name === undefined ? undefined : stripUserTextControls(input.name);
	} catch (error) {
		if (!(error instanceof SealedTextError)) throw error;
		throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid name" });
	}
	if (name !== undefined && !nameText.safeParse(name).success)
		throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid name" });
	const write: IdentityWrite = {
		...(name !== undefined ? { name } : {}),
	};
	const username = input.username?.toLowerCase();
	const email = input.email?.toLowerCase().trim();
	const newEmail = email !== undefined && email !== current.email ? email : null;
	// Everything that can refuse comes before the first write.
	if (newEmail !== null) {
		await assertPassword(userId, input.currentPassword);
		await assertEmailFree(db, userId, newEmail);
	}
	if (username !== undefined && username !== current.username) {
		await changeUsername(userId, username);
	}
	if (newEmail !== null && (await isEmailDeliveryEnabled())) {
		const user = await startEmailChange(db, current, write, newEmail);
		return { emailChangePending: true, user };
	}
	// The email column is not writable by the app role: an immediate change
	// (no email delivery) goes through the owner connection, for the caller's
	// own id only.
	const user = await (newEmail !== null ? globalDb : db).user.update({
		where: { id: userId },
		data: { ...write, ...(newEmail !== null ? { email: newEmail } : {}) },
		select: IDENTITY_SELECT,
	});
	// Needs the owner connection (guest rows are not the user's yet); the
	// helper re-checks emailVerified and never throws.
	if (newEmail !== null) await migrateGuestDataForVerifiedUser(globalDb, userId);
	return { emailChangePending: false, user };
}

export async function cancelPendingEmailChange(db: AppDb, userId: string) {
	await db.user.update({
		where: { id: userId },
		data: {
			pendingEmail: null,
			pendingEmailToken: null,
			pendingEmailExpiresAt: null,
		},
		select: { id: true },
	});
}

export async function getBackgroundSettings(
	db: AppDb,
	userId: string,
): Promise<BackgroundSettings> {
	const setting = await db.userPageSetting.findUnique({
		where: { userId_page: { userId, page: "PROFILE" } },
		select: { settings: true },
	});
	const parsed = backgroundSettingsSchema.safeParse(setting?.settings);
	return parsed.success ? parsed.data : defaultBackgroundSettings;
}

export async function saveBackgroundSettings(
	db: AppDb,
	userId: string,
	settings: BackgroundSettings,
): Promise<BackgroundSettings> {
	await db.userPageSetting.upsert({
		where: { userId_page: { userId, page: "PROFILE" } },
		create: { userId, page: "PROFILE", settings },
		update: { settings },
	});
	return settings;
}
