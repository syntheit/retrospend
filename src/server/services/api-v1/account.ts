import { deleteOwnAccount } from "~/server/services/account-deletion.service";
import { previewAccountDeletion } from "~/server/services/user-deletion.service";
import type { Caller } from "./caller";

/** v1 adapters for /me/deletion. The web's own service does the work. */

export function readAccountDeletion(caller: Caller) {
	return previewAccountDeletion(caller.db, caller.principal.userId);
}

export async function deleteAccount(caller: Caller, password: string) {
	const { userId, role } = caller.principal;
	await deleteOwnAccount(caller.db, { id: userId, role }, password);
	return { ok: true as const };
}
