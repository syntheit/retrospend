import type { Me, ServerInfo } from "@retrospend/api-contract";
import { APP_VERSION } from "~/lib/version";
import type { db as globalDb } from "~/server/db";
import { type PushConfig, pushConfig } from "~/server/services/push/config";
import { isInviteOnlyEnabled } from "~/server/services/settings";
import { getImageUrl } from "~/server/storage";
import type { Principal } from "./principal.service";

/**
 * The oldest app build this server still serves. Raise it when a release
 * removes something older builds rely on; they then ask the user to update.
 */
export const MIN_CLIENT_VERSION = "0.0.0";

/**
 * GET /server-info. The push transports are the senders this server has
 * settings for (src/server/services/push/config.ts), so an app never offers
 * a transport the server cannot use.
 */
export async function getServerInfo(
	push: PushConfig = pushConfig(),
): Promise<ServerInfo> {
	const inviteOnly = await isInviteOnlyEnabled();
	return {
		name: "Retrospend",
		version: APP_VERSION,
		apiVersion: "v1",
		minClientVersion: MIN_CLIENT_VERSION,
		features: {},
		auth: {
			methods: ["password", "totp", "bearer", "apiKey", "deviceAuthorization"],
			signUp: inviteOnly ? "inviteOnly" : "open",
		},
		push: {
			transports: [
				...(push.apns ? (["apns"] as const) : []),
				...(push.fcm ? (["fcm"] as const) : []),
				...(push.webPush ? (["unifiedpush"] as const) : []),
			],
			...(push.webPush && { vapidPublicKey: push.webPush.publicKey }),
		},
	};
}

/** GET /me, read through the caller's user-scoped client. */
export async function getMe(
	userDb: typeof globalDb,
	principal: Principal,
): Promise<Me> {
	const user = await userDb.user.findUniqueOrThrow({
		where: { id: principal.userId },
		select: {
			id: true,
			email: true,
			username: true,
			name: true,
			image: true,
			avatarPath: true,
			role: true,
			homeCurrency: true,
			defaultCurrency: true,
			fiscalMonthStartDay: true,
			language: true,
			currencySymbolStyle: true,
			numberFormat: true,
			emailVerified: true,
			twoFactorEnabled: true,
			createdAt: true,
		},
	});
	const { avatarPath, createdAt, ...rest } = user;
	return {
		...rest,
		avatarUrl: getImageUrl(avatarPath) ?? user.image,
		createdAt: createdAt.toISOString(),
		twoFactorEnabled: user.twoFactorEnabled ?? false,
		principal: {
			kind: principal.kind,
			scopes: principal.scopes,
			expiresAt: principal.expiresAt?.toISOString() ?? null,
			clientId: principal.clientId,
		},
	};
}
