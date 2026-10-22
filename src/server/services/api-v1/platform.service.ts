import type { Me, ServerInfo } from "@retrospend/api-contract";
import { APP_VERSION } from "~/lib/version";
import type { db as globalDb } from "~/server/db";
import { isFlagEnabled } from "~/server/flags";
import { isInviteOnlyEnabled } from "~/server/services/settings";
import type { Principal } from "./principal.service";

/**
 * The oldest app build this server still serves. Raise it when a release
 * removes something older builds rely on; they then ask the user to update.
 */
export const MIN_CLIENT_VERSION = "0.0.0";

/**
 * GET /server-info. Features are evaluated for the caller when they sent
 * valid credentials (an admin sees apiV1 on while it is ADMINS only),
 * otherwise for a signed-out viewer. Push transports stay empty until the
 * push fan-out ships (S3 wave 3); listing them earlier would be fake data.
 */
export async function getServerInfo(
	principal: Principal | null,
): Promise<ServerInfo> {
	const viewer = principal ? { role: principal.role } : null;
	const [apiV1, uiV2, envelopeBudget, inviteOnly] = await Promise.all([
		isFlagEnabled("apiV1", viewer),
		isFlagEnabled("uiV2", viewer),
		isFlagEnabled("envelopeBudget", viewer),
		isInviteOnlyEnabled(),
	]);
	return {
		name: "Retrospend",
		version: APP_VERSION,
		apiVersion: "v1",
		minClientVersion: MIN_CLIENT_VERSION,
		features: { apiV1, uiV2, envelopeBudget },
		auth: {
			methods: ["password", "totp", "bearer", "apiKey", "deviceAuthorization"],
			signUp: inviteOnly ? "inviteOnly" : "open",
		},
		push: { transports: [] },
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
			role: true,
			homeCurrency: true,
			language: true,
			twoFactorEnabled: true,
		},
	});
	return {
		...user,
		twoFactorEnabled: user.twoFactorEnabled ?? false,
		principal: {
			kind: principal.kind,
			scopes: principal.scopes,
			expiresAt: principal.expiresAt?.toISOString() ?? null,
			clientId: principal.clientId,
		},
	};
}
