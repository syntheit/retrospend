// The read-back after the keys are saved: what the keys route answers, read
// again from the account's side. The server must hold what was sent (the
// parameters, the public key, each wrap the password opens) and the digest of
// the recovery wrap it keeps but never returns. A server that stored other
// bytes, or answers another key set, fails here and the person is told the
// keys could not be checked. Shared by the web and the phone through
// prepareEnable.
import { fromBase64Url } from "../base64url";
import { recoveryWrapDigest, unwrapKey } from "../keys";
import type { Primitives } from "../primitives";
import type { EnableBody } from "./enable";
import { KeyFlowError, readKdf, sameBytes, sameKdf } from "./flow";

/** What the read-back compares the answer with. The keys are the caller's to wipe. */
export type EnableHeld = {
	userId: string;
	accountKey: Uint8Array;
	privateKey: Uint8Array;
	body: EnableBody;
};

const fail = () => new KeyFlowError("readBackFailed");

const asObject = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

const bytesOf = (text: unknown): Uint8Array => {
	const bytes = typeof text === "string" ? fromBase64Url(text) : null;
	if (!bytes) throw fail();
	return bytes;
};

/** The bytes of the one stored wrap of a role in the answer. */
function storedWrap(wraps: unknown, role: string): Uint8Array {
	const found = (Array.isArray(wraps) ? wraps : []).filter(
		(w) => asObject(w).role === role,
	);
	if (found.length !== 1) throw fail();
	return bytesOf(asObject(found[0]).wrapped);
}

/**
 * Throws KeyFlowError("readBackFailed") unless the answer is the key set that
 * was sent. The password wrap is compared as bytes (the password's wrap key is
 * gone by now, and the bytes were opened before they were sent); the private
 * key and collection key wraps are opened with the account key held here, and
 * the opened private key must be the one made; the ak-recovery wrap is compared
 * by its digest. The parameters and the public key must be the ones sent.
 */
export function checkStoredKeys(
	p: Primitives,
	held: EnableHeld,
	answer: unknown,
): void {
	try {
		const stored = asObject(answer);
		const { body } = held;
		const kdf = readKdf(stored.kdf);
		if (!kdf || !sameKdf(kdf, body.kdf)) throw fail();
		if (!sameBytes(bytesOf(stored.publicKey), bytesOf(body.publicKey)))
			throw fail();

		const sent = (role: string) => {
			const wrap = body.wraps.find((w) => w.role === role);
			if (!wrap) throw fail();
			return { targetId: wrap.targetId, wrapped: bytesOf(wrap.wrapped) };
		};
		if (
			!sameBytes(
				storedWrap(stored.wraps, "ak-password"),
				sent("ak-password").wrapped,
			)
		)
			throw fail();
		const opened: Uint8Array[] = [];
		try {
			const privateKey = unwrapKey(
				p,
				held.accountKey,
				"private-key",
				held.userId,
				storedWrap(stored.wraps, "private-key"),
			);
			opened.push(privateKey);
			if (!sameBytes(privateKey, held.privateKey)) throw fail();
			opened.push(
				unwrapKey(
					p,
					held.accountKey,
					"collection-key",
					sent("collection-key").targetId,
					storedWrap(stored.wraps, "collection-key"),
				),
			);
		} finally {
			for (const key of opened) p.wipe(key);
		}

		const digest = bytesOf(stored.recoveryWrapDigest);
		const mine = recoveryWrapDigest(p, sent("ak-recovery").wrapped);
		if (!sameBytes(digest, mine)) throw fail();
	} catch {
		throw fail();
	}
}
