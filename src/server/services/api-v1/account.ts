import {
	deleteOwnAccount,
	previewOwnAccountDeletion,
} from "~/server/services/account-deletion.service";
import {
	changeOwnPassword,
	endOwnSession,
	listOwnSessions,
} from "~/server/services/account-security.service";
import type { Caller } from "./caller";

/** v1 adapters for /me/deletion. The web's own service does the work. */

export function readAccountDeletion(caller: Caller) {
	return previewOwnAccountDeletion(caller.principal.userId);
}

export async function deleteAccount(caller: Caller, password: string) {
	const { userId, role } = caller.principal;
	await deleteOwnAccount({ id: userId, role }, password);
	return { ok: true as const };
}

/** v1 adapters for /me/password and /me/sessions; the shared service does the work. */

export function changePassword(
	caller: Caller,
	input: { currentPassword: string; newPassword: string },
) {
	return changeOwnPassword({
		userId: caller.principal.userId,
		keepSessionId: caller.principal.tokenId,
		currentPassword: input.currentPassword,
		newPassword: input.newPassword,
	});
}

export async function readSessions(caller: Caller) {
	const rows = await listOwnSessions(
		caller.principal.userId,
		caller.principal.tokenId,
	);
	return {
		items: rows.map((r) => ({
			...r,
			createdAt: r.createdAt.toISOString(),
			lastUsedAt: r.lastUsedAt.toISOString(),
		})),
	};
}

export async function endSession(caller: Caller, sessionId: string) {
	await endOwnSession(
		caller.principal.userId,
		caller.principal.tokenId,
		sessionId,
	);
	return { ok: true as const };
}
