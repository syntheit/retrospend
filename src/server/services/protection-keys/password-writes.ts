/**
 * What a password write must settle first when the account has a protection
 * key set (E2EE K1). With keys, the stored hash is the hash of a sign-in
 * secret only the person's devices can derive, so a server-side password
 * change would lock them out of their data and a reset would strand the keys.
 *
 * Every hash writer (changeOwnPassword, the email reset, the admin reset, and
 * enable, rotate and the recovery commit) runs an interactive owner transaction,
 * takes the credential row lock here first and checks for a key set under it.
 * Enable takes the same lock, so a writer that waited sees the key set it
 * created. The four that follow a check share `swapCredentialHash`.
 */
import { isProtected } from "@retrospend/api-contract/protection-state";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { deleteUserResetTokens } from "../auth/reset-tokens";

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
 * Every caller of `swapCredentialHash` names itself, so the list of paths that
 * write a password hash after a check is the type, and a new writer must be
 * added here (and to the test that holds one case per member) before it
 * compiles.
 */
export const SWAP_WRITERS = ["change", "enable", "rotate", "recovery"] as const;
export type SwapWriter = (typeof SWAP_WRITERS)[number];

/**
 * What each writer needs, decided here and nowhere else. `keys`: whether the
 * account must be without or with a key set. `sessions`: whether the caller's
 * own session stays (the person is signed in and changing it) or every
 * session ends (a recovery has no session of its own to keep).
 */
const SWAP_RULES: Record<
	SwapWriter,
	{ keys: "absent" | "present"; sessions: "keep" | "endAll" }
> = {
	change: { keys: "absent", sessions: "keep" },
	enable: { keys: "absent", sessions: "keep" },
	rotate: { keys: "present", sessions: "keep" },
	recovery: { keys: "present", sessions: "endAll" },
};

/** Which sessions survive the write: one of them, or none. */
export type SessionPolicy = { keep: string } | { endAll: true };

/**
 * The one write of a password hash that follows a check. For the person's own
 * change, the turn-on of protection keys and the rotation the check is the
 * current password; for the recovery commit it is the reset token and the
 * recovery proof, which the caller verified and spent in the same transaction.
 * The caller verified `checked` outside the transaction, because hashing is
 * slow; this locks the credential row, checks the key set rule of `writer`
 * under the lock, and replaces the hash only if it is still `checked`, so a
 * reset or another change that committed in between is a refusal, not an
 * overwrite. On success the sessions end as `sessions` says (every other one,
 * or all), and the user's pending reset links go too when `dropResetLinks` is
 * set (reset-tokens.ts). Nothing is written on a refusal, so the caller throws
 * its own error for it. A `sessions` that does not fit `writer` is a bug in the
 * caller and throws before anything is locked.
 */
export async function swapCredentialHash(
	tx: Prisma.TransactionClient,
	input: {
		writer: SwapWriter;
		userId: string;
		checked: string;
		hashed: string;
		sessions: SessionPolicy;
		dropResetLinks?: boolean;
	},
): Promise<CredentialSwap> {
	const { userId, sessions } = input;
	// Own keys only: "constructor" or "toString" must not pass for a writer.
	if (!Object.hasOwn(SWAP_RULES, input.writer))
		throw new Error("Unknown password writer");
	const rule = SWAP_RULES[input.writer];
	if ((rule.sessions === "keep") !== ("keep" in sessions))
		throw new Error(`The ${input.writer} writer cannot end sessions this way`);
	const locked = await lockCredential(tx, userId);
	if (!locked) return { ok: false, refusal: "no_credential" };
	if (rule.keys === "absent" && locked.hasKeySet)
		return { ok: false, refusal: "keys_present" };
	if (rule.keys === "present" && !locked.hasKeySet)
		return { ok: false, refusal: "keys_missing" };
	const swapped = await tx.account.updateMany({
		where: { userId, providerId: "credential", password: input.checked },
		data: { password: input.hashed },
	});
	if (swapped.count !== 1) return { ok: false, refusal: "hash_changed" };
	const ended = await tx.session.deleteMany({
		where: "keep" in sessions ? { userId, id: { not: sessions.keep } } : { userId },
	});
	if (input.dropResetLinks) await deleteUserResetTokens(tx, userId);
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
