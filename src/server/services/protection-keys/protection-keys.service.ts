/**
 * The protection key set of one user (E2EE F6a): what a client needs to unlock
 * Advanced protection, stored and returned but never opened. The server holds
 * the Argon2id salt and parameters, the account public key and the wrapped
 * keys; it cannot unwrap any of them and never logs their bytes. Not the D2
 * "keyring" (the server's own data keys): see docs/roadmap/e2ee-f6a.md.
 *
 * The functions run in the caller's transaction. Changing the salt together
 * with the better-auth password hash is one transaction F8b and K1 own: this
 * writer alone could lock a user out, so it has no `updateKdf`.
 */
import { Prisma } from "~prisma";
import { ProtectionKeysError } from "./errors";
import {
	type KeyChanges,
	type KeyWriter,
	validateKeyChanges,
	type WrapRef,
} from "./validate";

export { ProtectionKeysError } from "./errors";
export type {
	KeyChanges,
	KeyWriter,
	WrapInput,
	WrapRef,
} from "./validate";

/** The set's own columns: what a reader that returns no wrap asks for. */
export type KeySet = {
	kdfSalt: Uint8Array;
	kdfMemoryKiB: number;
	kdfPasses: number;
	publicKey: Uint8Array;
	version: number;
	createdAt: Date;
};

/** A copy that is a plain Uint8Array, whether the driver hands back a Buffer or not. */
export const plain = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
	Uint8Array.from(bytes);

/**
 * The set's own columns, or null when the user has none. Names every column
 * it reads: the app role cannot select "recoveryHash". It never reads a wrap:
 * the only reader of wrap bytes is release.ts.
 */
export async function getKeySet(
	tx: Prisma.TransactionClient,
	userId: string,
): Promise<KeySet | null> {
	const [row] = await tx.$queryRaw<KeySet[]>`
		SELECT "kdfSalt", "kdfMemoryKiB", "kdfPasses", "publicKey", "version", "createdAt"
		FROM "protection_key_set" WHERE "userId" = ${userId}`;
	if (!row) return null;
	return {
		kdfSalt: plain(row.kdfSalt),
		kdfMemoryKiB: row.kdfMemoryKiB,
		kdfPasses: row.kdfPasses,
		publicKey: plain(row.publicKey),
		version: row.version,
		createdAt: row.createdAt,
	};
}

const isUniqueViolation = (error: unknown): boolean =>
	error instanceof Prisma.PrismaClientKnownRequestError &&
	error.code === "P2002";

/** The set row, locked until the transaction ends so two writers take turns. */
async function lockVersion(
	tx: Prisma.TransactionClient,
	userId: string,
): Promise<number | null> {
	const rows = await tx.$queryRaw<{ version: number }[]>`
		SELECT "version" FROM "protection_key_set"
		WHERE "userId" = ${userId} FOR UPDATE`;
	return rows[0]?.version ?? null;
}

/**
 * Applies one change to the key set and its wraps and returns the new version.
 * `baseVersion` is the version the caller read: 0 creates the set (it must not
 * exist), anything else must equal the stored one or the change is a
 * `conflict`. A wrap in `put` replaces the stored one of the same role and
 * target, and the old row is deleted, not kept: a superseded wrap still opens
 * the current account key, so keeping it would defeat a password change made
 * because the old one leaked, and a removed trusted person. `remove` deletes
 * wraps by role and target. Everything runs in the caller's transaction, so a
 * failure leaves nothing changed, and the version moves once. `writer` names
 * the caller, and validate.ts decides what that caller may do (who creates the
 * set, who writes the recovery proof, which always travels with its wrap).
 * Callers run on the owner connection: the app role has no INSERT, no DELETE
 * and no read of the recovery hash.
 */
export async function applyKeyChanges(
	tx: Prisma.TransactionClient,
	userId: string,
	changes: KeyChanges,
	writer: KeyWriter,
): Promise<{ version: number }> {
	validateKeyChanges(userId, changes, writer);
	const { baseVersion, set, put, remove, recoveryHash } = changes;
	let version: number;
	try {
		if (baseVersion === 0) {
			// ON CONFLICT DO NOTHING waits for a concurrent creator and then
			// inserts nothing, so the loser gets a conflict, not an aborted transaction.
			if (!set?.publicKey) throw new ProtectionKeysError("invalid_input");
			const created = await tx.protectionKeySet.createMany({
				data: [
					{
						userId,
						kdfSalt: Uint8Array.from(set.kdfSalt),
						kdfMemoryKiB: set.kdfMemoryKiB,
						kdfPasses: set.kdfPasses,
						publicKey: Uint8Array.from(set.publicKey),
						...(recoveryHash && {
							recoveryHash: Uint8Array.from(recoveryHash),
						}),
					},
				],
				skipDuplicates: true,
			});
			if (created.count !== 1) throw new ProtectionKeysError("conflict");
			version = 1;
		} else {
			if ((await lockVersion(tx, userId)) !== baseVersion)
				throw new ProtectionKeysError("conflict");
			version = baseVersion + 1;
			await tx.protectionKeySet.update({
				where: { userId },
				// Nothing is read back: the row holds the recovery hash.
				select: { userId: true },
				data: {
					version,
					...(recoveryHash && {
						recoveryHash: Uint8Array.from(recoveryHash),
					}),
					...(set && {
						kdfSalt: Uint8Array.from(set.kdfSalt),
						kdfMemoryKiB: set.kdfMemoryKiB,
						kdfPasses: set.kdfPasses,
					}),
				},
			});
		}
		const gone: WrapRef[] = [...remove, ...put];
		if (gone.length > 0) {
			await tx.protectionKeyWrap.deleteMany({
				where: {
					userId,
					OR: gone.map(({ role, targetId }) => ({ role, targetId })),
				},
			});
		}
		if (put.length > 0) {
			await tx.protectionKeyWrap.createMany({
				data: put.map((wrap) => ({
					...(wrap.id && { id: wrap.id }),
					userId,
					role: wrap.role,
					targetId: wrap.targetId,
					wrapped: Uint8Array.from(wrap.wrapped),
				})),
			});
		}
	} catch (error) {
		// A duplicate wrap id or slot: someone else wrote since the caller read.
		if (isUniqueViolation(error)) throw new ProtectionKeysError("conflict");
		throw error;
	}
	return { version };
}
