import type {
	BeginRecovery,
	Recover,
	RecoverResult,
} from "@retrospend/api-contract";
import { toBase64Url } from "@retrospend/crypto";
import { problem } from "~/server/api/v1/errors";
import { ReleaseError } from "~/server/services/protection-keys/errors";
import {
	beginRecovery,
	checkRecovery,
	commitRecovery,
} from "~/server/services/protection-keys/recover";

/**
 * v1 adapters for /auth/recovery. The recovery service owns every rule (the
 * link, the proof, the tries); these only put its answers on the wire. None of
 * them reads a session: the account is whoever the link names.
 */

/**
 * A refused recovery proof is the recovery key's own problem code, not the
 * password's: a client words it differently. Every other refusal keeps the
 * mapping the key routes share (`toProblem`).
 */
async function asRecoveryProof<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof ReleaseError && error.code === "wrong_proof")
			throw problem("wrong_recovery_key", "Recovery key is incorrect");
		throw error;
	}
}

export const check = (token: string) => checkRecovery(token);

export async function begin(input: BeginRecovery) {
	const begun = await asRecoveryProof(() => beginRecovery(input));
	return {
		userId: begun.userId,
		version: begun.version,
		publicKey: toBase64Url(begun.publicKey),
		wraps: begun.wraps.map((w) => ({
			role: w.role,
			targetId: w.targetId,
			wrapped: toBase64Url(w.wrapped),
		})),
	};
}

export const commit = (input: Recover): Promise<RecoverResult> =>
	asRecoveryProof(() => commitRecovery(input));
