/**
 * What a password write must settle first when the account has a protection
 * key set (E2EE K1). With keys, the stored hash is the hash of a sign-in
 * secret only the person's devices can derive, so a server-side password
 * change would lock them out of their data and a reset would strand the keys.
 *
 * Every hash writer (changeOwnPassword, the email reset, the admin reset, and
 * enable and rotate) runs an interactive owner transaction, takes the credential
 * row lock here first and checks for a key set under it. Enable takes the same
 * lock, so a writer that waited sees the key set it created. The three that
 * follow a check of the current password share `swapCredentialHash`.
 */
import { isProtected } from "@retrospend/api-contract/protection-state";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";

/**
 * The account has Advanced protection keys, so the server cannot set its
 * password. Clients show the locked-feature reason by the `protected_password`
 * problem code, never by this message.
 */
export class ProtectedPasswordError extends TRPCError {
	constructor() {
		super({ code: "FORBIDDEN", message: "The password is protected" });
	}
}

type KeyedState = { hasKeySet: boolean; protectionState: string | null };

/**
 * Locks the user's credential account row until the transaction ends and says
 * whether a key set exists, or null when there is no credential account. Two
 * statements on purpose: a row lock that had to wait re-checks only the locked
 * row, so a key set committed while we waited is not seen by a subselect in the
 * same statement. The second statement takes a fresh snapshot.
 */
export async function lockCredential(
	tx: Prisma.TransactionClient,
	userId: string,
): Promise<KeyedState | null> {
	const locked = await tx.$queryRaw<{ id: string }[]>`
		SELECT "id" FROM "account"
		WHERE "userId" = ${userId} AND "providerId" = 'credential'
		FOR UPDATE`;
	if (locked.length === 0) return null;
	const [state] = await tx.$queryRaw<
		{ hasKeySet: boolean; protectionState: string | null }[]
	>`
		SELECT EXISTS (SELECT 1 FROM "protection_key_set" WHERE "userId" = ${userId}) AS "hasKeySet",
		       (SELECT "protectionState"::text FROM "user" WHERE "id" = ${userId}) AS "protectionState"`;
	return state ?? { hasKeySet: false, protectionState: null };
}

/** Whether the user has a key set, outside any lock (a cheap early answer). */
export async function hasKeySet(
	client: Pick<Prisma.TransactionClient, "protectionKeySet">,
	userId: string,
): Promise<boolean> {
	const row = await client.protectionKeySet.findUnique({
		where: { userId },
		select: { userId: true },
	});
	return row !== null;
}

/**
 * Removes every pending password reset link for an address, in the caller's
 * transaction. A link made earlier would write a hash around keys that were
 * just created or rotated.
 */
export async function deleteResetTokens(
	tx: Prisma.TransactionClient,
	email: string,
): Promise<void> {
	await tx.passwordResetToken.deleteMany({ where: { identifier: email } });
}

export type SwapRefusal =
	/** The account has no credential row. */
	| "no_credential"
	/** The caller needs a keyless account and a key set exists. */
	| "keys_present"
	/** The caller needs a keyed account and no key set exists. */
	| "keys_missing"
	/** The stored hash is no longer the one the caller checked. */
	| "hash_changed";

export type CredentialSwap =
	| { ok: true; signedOut: number }
	| { ok: false; refusal: SwapRefusal };

/**
 * The one write of a password hash that follows a check of the current
 * password (the person's own change, the turn-on of protection keys, the
 * rotation). The caller verified `checked` outside the transaction, because
 * hashing is slow; this locks the credential row, checks the key set rule
 * under the lock (`keys`), and replaces the hash only if it is still `checked`,
 * so a reset or another change that committed in between is a refusal, not an
 * overwrite. On success every other session ends, and the pending reset links
 * of `resetLinksFor` (an address) go too when given. Nothing is written on a
 * refusal, so the caller throws its own error for it.
 */
export async function swapCredentialHash(
	tx: Prisma.TransactionClient,
	input: {
		userId: string;
		checked: string;
		hashed: string;
		keys: "absent" | "present";
		keepSessionId: string;
		resetLinksFor?: string;
	},
): Promise<CredentialSwap> {
	const { userId } = input;
	const locked = await lockCredential(tx, userId);
	if (!locked) return { ok: false, refusal: "no_credential" };
	if (input.keys === "absent" && locked.hasKeySet)
		return { ok: false, refusal: "keys_present" };
	if (input.keys === "present" && !locked.hasKeySet)
		return { ok: false, refusal: "keys_missing" };
	const swapped = await tx.account.updateMany({
		where: { userId, providerId: "credential", password: input.checked },
		data: { password: input.hashed },
	});
	if (swapped.count !== 1) return { ok: false, refusal: "hash_changed" };
	const ended = await tx.session.deleteMany({
		where: { userId, id: { not: input.keepSessionId } },
	});
	if (input.resetLinksFor !== undefined)
		await deleteResetTokens(tx, input.resetLinksFor);
	return { ok: true, signedOut: ended.count };
}

/**
 * A reset (the person forgot the password, or an admin sets one). While
 * nothing is sealed (`OFF`) the keys protect no data, so they are removed in
 * the caller's transaction, with the new hash, and the account returns to a
 * plain password, and the vault rows sealed under them go too. Anything else is
 * refused: the keys are the only way back into sealed data. The audit entry carries ids only.
 */
export type ResetBy = { kind: "email" } | { kind: "admin"; adminId: string };

export async function settleKeysForReset(
	tx: Prisma.TransactionClient,
	userId: string,
	state: KeyedState,
	by: ResetBy,
): Promise<{ keysRemoved: boolean }> {
	if (!state.hasKeySet) return { keysRemoved: false };
	if (isProtected(state.protectionState)) throw new ProtectedPasswordError();
	await tx.protectionKeyWrap.deleteMany({ where: { userId } });
	await tx.protectionKeySet.deleteMany({ where: { userId } });
	// Records sealed under the removed keys can never be opened, and while the
	// state is OFF the plaintext still exists, so nothing is lost. The key set
	// delete above waits for a vault writer that holds the row FOR SHARE
	// (vault-api.service.ts), so this sees the rows that writer committed; a
	// writer that comes later finds no key set and stores nothing. This runs
	// on the owner connection: the app role cannot delete vault rows.
	await tx.$executeRaw`DELETE FROM "vault_record" WHERE "userId" = ${userId}`;
	await tx.eventLog.create({
		data: {
			eventType: "PASSWORD_RESET",
			userId,
			metadata: {
				reason: "protection_keys_removed",
				action: by.kind === "admin" ? "admin_reset" : "email_reset",
				adminId: by.kind === "admin" ? by.adminId : undefined,
			},
		},
	});
	return { keysRemoved: true };
}
