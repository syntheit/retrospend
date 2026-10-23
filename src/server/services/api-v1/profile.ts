import type { ProfileDto, updateProfileSchema } from "@retrospend/api-contract";
import type * as z from "zod";
import type { BackgroundSettings } from "~/lib/background-settings";
import { removeAvatar, replaceAvatar } from "~/server/services/avatar.service";
import {
	cancelPendingEmailChange,
	getBackgroundSettings,
	getProfile,
	saveBackgroundSettings,
	updateProfile,
} from "~/server/services/profile.service";
import { getImageUrl } from "~/server/storage";
import type { Caller } from "./caller";

/** v1 adapters for /profile. */

async function profileOf(caller: Caller): Promise<ProfileDto> {
	const row = await getProfile(caller.db, caller.principal.userId);
	return {
		id: row.id,
		name: row.name,
		username: row.username,
		email: row.email,
		avatarUrl: getImageUrl(row.avatarPath) ?? row.image,
		pendingEmail: row.pendingEmail
			? {
					email: row.pendingEmail,
					expiresAt: row.pendingEmailExpiresAt?.toISOString() ?? null,
				}
			: null,
		createdAt: row.createdAt.toISOString(),
	};
}

export const readProfile = profileOf;

/** Fields left out keep their current value. */
export async function patchProfile(
	caller: Caller,
	patch: z.infer<typeof updateProfileSchema>,
) {
	const current = await getProfile(caller.db, caller.principal.userId);
	const { emailChangePending } = await updateProfile(caller.db, current, {
		name: patch.name ?? current.name,
		username: patch.username ?? current.username,
		email: patch.email ?? current.email,
		currentPassword: patch.currentPassword,
	});
	return { ...(await profileOf(caller)), emailChangePending };
}

export async function dropPendingEmail(caller: Caller) {
	await cancelPendingEmailChange(caller.db, caller.principal.userId);
	return { ok: true as const };
}

export async function putAvatar(caller: Caller, file: File) {
	return replaceAvatar(
		caller.db,
		caller.principal.userId,
		Buffer.from(await file.arrayBuffer()),
	);
}

export async function deleteAvatar(caller: Caller) {
	await removeAvatar(caller.db, caller.principal.userId);
	return { ok: true as const };
}

export function readBackground(caller: Caller) {
	return getBackgroundSettings(caller.db, caller.principal.userId);
}

export function putBackground(caller: Caller, settings: BackgroundSettings) {
	return saveBackgroundSettings(caller.db, caller.principal.userId, settings);
}
