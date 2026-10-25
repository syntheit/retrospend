import {
	deleteOwnAccount,
	previewOwnAccountDeletion,
} from "~/server/services/account-deletion.service";
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
