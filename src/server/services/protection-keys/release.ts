/**
 * The one place wrap bytes leave the key tables, and the one owner of which
 * wraps leave under which proof (E2EE F6b; e2ee-k1-k3.md decision 4). The
 * server cannot open a wrap, but a wrap is the offline guessing target for
 * the password or the recovery key it was made under, so it is shown only to a
 * caller that proves it holds that secret first, and only the roles that
 * proof is for:
 *
 *   password   ak-password, private-key, collection-key (what a device opens
 *              with the password). Never ak-recovery: the recovery wrap is
 *              shown only as its digest, so a stolen password session gets no
 *              offline target for the recovery key. Never a public-key wrap.
 *
 * Callers pass a proof, never a role list: a new proof kind gets its own row in
 * `RELEASED_ROLES`, and a new reader of wrap bytes does not exist. The proof is
 * checked here too (it spends a password try, so a stolen cookie cannot guess
 * through this route), under the credential lock, so the wraps returned belong
 * to the hash that was checked.
 */
import {
	OPEN_WRAP_ROLES,
	type OpenWrapRole,
	type PreloginKdf,
} from "@retrospend/api-contract";
import { isSignInSecret } from "@retrospend/crypto";
import { verifyPassword } from "better-auth/crypto";
import { db } from "~/server/db";
import type { Prisma } from "~prisma";
import { spendPasswordTry } from "../account-security.service";
import { ReleaseError } from "./errors";
import { hasKeySet, lockCredential } from "./password-writes";
import { plain } from "./protection-keys.service";
import { digestOfRecoveryWrap } from "./recovery-digest";
import { invalid, readCredentialHash } from "./shared";
import type { WrapRole } from "./validate";

/** What the caller proves. Only the password today; recovery adds its own member. */
export type ReleaseProof = {
	kind: "password";
	/** The sign-in secret derived from the current password, as base64url. */
	authKey: string;
	/** The session that spends the try. */
	sessionId: string;
	/**
	 * Also answer the digest of the ak-recovery wrap (keys/open). A caller that
	 * does not show it (rotate begin) leaves this out and never loads the hash.
	 */
	withRecoveryDigest?: true;
};

/** The roles that leave under each proof kind. The whole list: nothing else is returned. */
const RELEASED_ROLES: Record<ReleaseProof["kind"], readonly OpenWrapRole[]> = {
	password: OPEN_WRAP_ROLES,
};

export type ReleasedWrap = {
	id: string;
	role: OpenWrapRole;
	targetId: string;
	wrapped: Uint8Array;
};

export type Released = {
	version: number;
	createdAt: Date;
	kdf: Pick<PreloginKdf, "memoryKiB" | "passes"> & { salt: Uint8Array };
	publicKey: Uint8Array;
	wraps: ReleasedWrap[];
	/** BLAKE2b-256 of the stored ak-recovery wrap; null when the set has none or the caller did not ask. */
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
 * Checks the proof and releases the wraps that proof is for. Throws
 * `ReleaseError` for a refusal (`no_keys` before a try is spent, then the try,
 * then `no_password`, `wrong_proof` or `changed`) and
 * `PasswordTriesExceededError` when the tries are used up.
 */
export async function releaseWraps(
	userId: string,
	proof: ReleaseProof,
): Promise<Released> {
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

	const rows = await db.$transaction(async (tx) => {
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
	const recovery = stored.find(
		(w) => w.role === "ak-recovery" && w.targetId === userId,
	);
	const digest =
		recovery && proof.withRecoveryDigest
			? await digestOfRecoveryWrap(recovery.wrapped)
			: null;
	const roles = RELEASED_ROLES[proof.kind];
	const released: ReleasedWrap[] = stored.flatMap((w) =>
		roles.some((role) => role === w.role)
			? [{ ...w, role: w.role as OpenWrapRole }]
			: [],
	);
	return {
		version: first.version,
		createdAt: first.createdAt,
		kdf: {
			salt: plain(first.kdfSalt),
			memoryKiB: first.kdfMemoryKiB,
			passes: first.kdfPasses,
		},
		publicKey: plain(first.publicKey),
		wraps: released,
		recoveryWrapDigest: digest,
	};
}
