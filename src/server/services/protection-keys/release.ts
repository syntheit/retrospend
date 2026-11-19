/**
 * The one place wrap bytes leave the key tables, and the one owner of which
 * wraps leave under which proof (E2EE F6b, K3-2a; e2ee-k1-k3.md decision 4).
 * The server cannot open a wrap, but a wrap is the offline guessing target for
 * the password or the recovery key it was made under, so it is shown only to a
 * caller that proves it holds that secret first, and only the roles that
 * proof is for:
 *
 *   password   ak-password, private-key, collection-key (what a device opens
 *              with the password). Never ak-recovery: the recovery wrap is
 *              shown only as its digest, so a stolen password session gets no
 *              offline target for the recovery key. Never a public-key wrap.
 *   recovery   ak-recovery and private-key (what the recovery key opens), to a
 *              caller holding a live reset link and the recovery proof. Never
 *              ak-password: a stolen link and key must not hand over the
 *              offline target for the password.
 *
 * Callers name themselves (`reader`), never a role list: a new reader of wrap
 * bytes is a new member of `RELEASE_READERS` with its own row in `READERS` and
 * its own test. Each proof is checked here too, so a stolen cookie or link
 * cannot guess through this route: the password spends a password try, under
 * the credential lock, so the wraps returned belong to the hash that was
 * checked; the recovery key spends a recovery try (`proveRecovery`).
 */
import {
	OPEN_WRAP_ROLES,
	type OpenWrapRole,
	type PreloginKdf,
	RECOVERY_WRAP_ROLES,
} from "@retrospend/api-contract";
import { isSignInSecret } from "@retrospend/crypto";
import { verifyPassword } from "better-auth/crypto";
import { db } from "~/server/db";
import type { Prisma } from "~prisma";
import { spendPasswordTry, spendRecoveryTry } from "../account-security.service";
import { ReleaseError } from "./errors";
import { hasKeySet, lockCredential } from "./password-writes";
import { plain } from "./protection-keys.service";
import { digestOfRecoveryWrap } from "./recovery-digest";
import { invalid, readCredentialHash } from "./shared";
import { recoveryProofMatches, type WrapRole } from "./validate";

/** Every caller of `releaseWraps`; the test holds one case per member. */
export const RELEASE_READERS = ["rotateBegin", "keysOpen", "recoveryBegin"] as const;
export type ReleaseReader = (typeof RELEASE_READERS)[number];

/** What the caller proves. */
export type ReleaseProof =
	| {
			reader: "rotateBegin" | "keysOpen";
			/** The sign-in secret derived from the current password, as base64url. */
			authKey: string;
			/** The session that spends the try. */
			sessionId: string;
	  }
	| {
			reader: "recoveryBegin";
			/** The recovery auth key (RK subkey 2), as base64url. */
			recoveryAuthKey: string;
			/** The stored hash of the reset link that opened this, which counts the try. */
			tokenHash: string;
	  };

/**
 * The roles that leave to each reader, and whether the digest of the ak-recovery
 * wrap goes with them. The whole list: nothing else is returned. Rotate begin
 * needs the password wrap only; keys/open is the device's unlock read.
 */
const READERS = {
	rotateBegin: { roles: ["ak-password"], digest: false },
	keysOpen: { roles: OPEN_WRAP_ROLES, digest: true },
	recoveryBegin: { roles: RECOVERY_WRAP_ROLES, digest: false },
} as const satisfies Record<
	ReleaseReader,
	{ roles: readonly WrapRole[]; digest: boolean }
>;

type RolesOf<R extends ReleaseReader> = (typeof READERS)[R]["roles"][number];

export type ReleasedWrap<Role extends WrapRole = OpenWrapRole> = {
	id: string;
	role: Role;
	targetId: string;
	wrapped: Uint8Array;
};

export type Released<Role extends WrapRole = OpenWrapRole> = {
	version: number;
	createdAt: Date;
	kdf: Pick<PreloginKdf, "memoryKiB" | "passes"> & { salt: Uint8Array };
	publicKey: Uint8Array;
	wraps: ReleasedWrap<Role>[];
	/** BLAKE2b-256 of the stored ak-recovery wrap; null when the set has none or the reader does not show it. */
	recoveryWrapDigest: Uint8Array | null;
};

type Row = {
	kdfSalt: Uint8Array;
	kdfMemoryKiB: number;
	kdfPasses: number;
	publicKey: Uint8Array;
	version: number;
	createdAt: Date;
	wrapId: string | null;
	role: WrapRole | null;
	targetId: string | null;
	wrapped: Uint8Array | null;
};

/**
 * The set and every wrap it holds, from one statement so the version and the
 * wraps share a snapshot. Private on purpose: it returns every role, and only
 * `releaseWraps` filters them.
 */
async function readSetAndWraps(
	tx: Prisma.TransactionClient,
	userId: string,
): Promise<Row[]> {
	return tx.$queryRaw<Row[]>`
		SELECT s."kdfSalt", s."kdfMemoryKiB", s."kdfPasses", s."publicKey", s."version", s."createdAt",
		       w."id"::text AS "wrapId", w."role", w."targetId", w."wrapped"
		FROM "protection_key_set" s
		LEFT JOIN "protection_key_wrap" w ON w."userId" = s."userId"
		WHERE s."userId" = ${userId}
		ORDER BY w."role", w."targetId"`;
}

/**
 * Checks the recovery proof against the hash the set stores (SHA-256 of the
 * recovery auth key, compared in constant time by validate.ts). Spends no try.
 * Throws `ReleaseError`: `no_keys`, `recovery_unavailable` for a set made before
 * the proof existed, `wrong_proof`. Anything it cannot read as a match is a
 * refusal (fail closed). Callers that must not see the hash change under them
 * call it in a transaction that holds the set row.
 */
export async function checkRecoveryProof(
	client: Pick<Prisma.TransactionClient, "protectionKeySet">,
	input: { userId: string; recoveryAuthKey: string },
): Promise<void> {
	const set = await client.protectionKeySet.findUnique({
		where: { userId: input.userId },
		select: { recoveryHash: true },
	});
	if (!set) throw new ReleaseError("no_keys");
	if (!set.recoveryHash) throw new ReleaseError("recovery_unavailable");
	if (!recoveryProofMatches(set.recoveryHash, input.recoveryAuthKey))
		throw new ReleaseError("wrong_proof");
}

/**
 * Counts a recovery try, then checks the proof (`checkRecoveryProof`); the try
 * is spent first, so every refusal costs one. Throws what that does and
 * `RecoveryTriesExceededError`. The recovery commit calls it before its slow
 * work and checks again under the set lock; begin (through `releaseWraps`)
 * spends its own try, so each spends one and neither trusts the other.
 */
export async function proveRecovery(
	client: Pick<Prisma.TransactionClient, "protectionKeySet">,
	input: { userId: string; tokenHash: string; recoveryAuthKey: string },
): Promise<void> {
	if (!isSignInSecret(input.recoveryAuthKey)) invalid();
	await spendRecoveryTry(input.userId, input.tokenHash);
	await checkRecoveryProof(client, input);
}

/** Checks the password proof (a counted try, under the credential lock). */
async function provePassword(
	userId: string,
	proof: Extract<ReleaseProof, { reader: "rotateBegin" | "keysOpen" }>,
): Promise<Row[]> {
	if (!isSignInSecret(proof.authKey)) invalid();
	// A keyless account has nothing to release; answered before a try is spent.
	if (!(await hasKeySet(db, userId))) throw new ReleaseError("no_keys");

	await spendPasswordTry(userId, proof.sessionId);
	const checked = await readCredentialHash(userId);
	if (!checked) throw new ReleaseError("no_password");
	if (!(await verifyPassword({ password: proof.authKey, hash: checked }))) {
		// A reset that removed the keys since the first look replaced the hash.
		if (!(await hasKeySet(db, userId))) throw new ReleaseError("no_keys");
		throw new ReleaseError("wrong_proof");
	}

	return db.$transaction(async (tx) => {
		const locked = await lockCredential(tx, userId);
		if (!locked?.hasKeySet) throw new ReleaseError("no_keys");
		const current = await tx.account.findFirst({
			where: { userId, providerId: "credential" },
			select: { password: true },
		});
		// The hash changed since it was checked: the proof is for an old password.
		if (current?.password !== checked) throw new ReleaseError("changed");
		return readSetAndWraps(tx, userId);
	});
}

/**
 * Checks the reader's proof and releases the wraps that proof is for. Throws
 * `ReleaseError` for a refusal (`no_keys` before a try is spent for a
 * password, then the try, then `no_password`, `wrong_proof`, `changed`,
 * `recovery_unavailable`) and `PasswordTriesExceededError` or
 * `RecoveryTriesExceededError` when the tries are used up.
 */
export async function releaseWraps<P extends ReleaseProof>(
	userId: string,
	proof: P,
): Promise<Released<RolesOf<P["reader"]>>> {
	// Narrowed on a plain copy: a generic parameter does not narrow by its tag.
	const given: ReleaseProof = proof;
	let rows: Row[];
	if (given.reader === "recoveryBegin") {
		rows = await db.$transaction(async (tx) => {
			// Share-locked, so the hash that is checked is the one the wraps
			// belong to: a writer of the set waits until this commits. The try is
			// spent on its own connection (counters commit even when this rolls back).
			await tx.$queryRaw`
				SELECT "userId" FROM "protection_key_set" WHERE "userId" = ${userId} FOR SHARE`;
			await proveRecovery(tx, {
				userId,
				tokenHash: given.tokenHash,
				recoveryAuthKey: given.recoveryAuthKey,
			});
			return readSetAndWraps(tx, userId);
		});
	} else {
		rows = await provePassword(userId, given);
	}
	const first = rows[0];
	if (!first) throw new ReleaseError("no_keys");

	const stored = rows.flatMap((r) =>
		r.wrapId && r.role && r.targetId && r.wrapped
			? [
					{
						id: r.wrapId,
						role: r.role,
						targetId: r.targetId,
						wrapped: plain(r.wrapped),
					},
				]
			: [],
	);
	const reader = READERS[proof.reader];
	const recovery = stored.find(
		(w) => w.role === "ak-recovery" && w.targetId === userId,
	);
	const digest =
		recovery && reader.digest
			? await digestOfRecoveryWrap(recovery.wrapped)
			: null;
	const roles: readonly WrapRole[] = reader.roles;
	const released = stored.filter((w) => roles.includes(w.role));
	return {
		version: first.version,
		createdAt: first.createdAt,
		kdf: {
			salt: plain(first.kdfSalt),
			memoryKiB: first.kdfMemoryKiB,
			passes: first.kdfPasses,
		},
		publicKey: plain(first.publicKey),
		// The filter above is the only way a role gets here.
		wraps: released as ReleasedWrap<RolesOf<P["reader"]>>[],
		recoveryWrapDigest: digest,
	};
}
