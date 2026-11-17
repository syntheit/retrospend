// Wraps of a key to a public key (ak-device, ak-contact). NOT part of the
// production entry (index.ts): the entry for device approval and trusted
// contact recovery (K4) is "@retrospend/crypto/k4", and nothing else may import
// this file.
//
// REQUIREMENT before K4 ships: these wraps do NOT authenticate the account key.
// A sealed box has no sender, so anyone with the recipient's public key, the
// server included, can seal any 32 bytes for that role and id. A substitute AK
// that also comes with a matching private-key wrap and collection-key wraps is
// not detected by the recipient. Closing this is a protocol decision that is
// still open (spike 4.4, threat model 5.6 and 11.1): either the device pins a
// commitment to AK when it approves (for example BLAKE2b of AK in secure
// storage, checked on every unwrap), or the approving device authenticates the
// wrap (crypto_box with its static key, checked against a confirmed
// fingerprint). Which one decides the shape of unwrapKeyFromPublic (an expected
// commitment argument, or an authenticated box), so the shape is not guessed
// here: the pair stays out of the production entry until K4 picks one and
// builds the unwrap that cannot return a bare AK.
import { bad, failed } from "./errors";
import {
	ascii,
	oneOf,
	PUBLIC_ROLES,
	PUBLIC_WRAP_BYTES,
	type PublicRole,
	WRAP_BINDING_BYTES,
	WRAP_HEADER_BYTES,
	WRAP_TO_PUBLIC,
	WRAP_VERSION,
	wrapAad,
} from "./keys";
import {
	type BoxKeyPair,
	isBytes,
	KEY_BYTES,
	type Primitives,
} from "./primitives";

export function wrapKeyToPublic(
	p: Primitives,
	publicKey: Uint8Array,
	role: PublicRole,
	id: string,
	key: Uint8Array,
): Uint8Array {
	if (!isBytes(key) || key.length !== KEY_BYTES) bad();
	const aad = wrapAad(WRAP_TO_PUBLIC, oneOf(PUBLIC_ROLES, role), id);
	const plain = new Uint8Array(KEY_BYTES + WRAP_BINDING_BYTES);
	plain.set(key);
	plain.set(p.blake2b(ascii(aad), WRAP_BINDING_BYTES), KEY_BYTES);
	try {
		const sealed = p.seal(plain, publicKey);
		const out = new Uint8Array(WRAP_HEADER_BYTES + sealed.length);
		out.set([WRAP_VERSION, WRAP_TO_PUBLIC]);
		out.set(sealed, WRAP_HEADER_BYTES);
		return out;
	} finally {
		p.wipe(plain);
	}
}

/** Returns a bare, unauthenticated key: see the requirement at the top. */
export function unwrapKeyFromPublic(
	p: Primitives,
	pair: BoxKeyPair,
	role: PublicRole,
	id: string,
	wrapped: Uint8Array,
): Uint8Array {
	const aad = wrapAad(WRAP_TO_PUBLIC, oneOf(PUBLIC_ROLES, role), id);
	if (!isBytes(wrapped)) bad();
	if (wrapped.length < WRAP_HEADER_BYTES) failed();
	if (wrapped[0] !== WRAP_VERSION || wrapped[1] !== WRAP_TO_PUBLIC) bad();
	if (wrapped.length !== PUBLIC_WRAP_BYTES) failed();
	const plain = p.sealOpen(
		wrapped.subarray(WRAP_HEADER_BYTES),
		pair.publicKey,
		pair.privateKey,
	);
	try {
		const want = p.blake2b(ascii(aad), WRAP_BINDING_BYTES);
		let diff = plain.length === KEY_BYTES + WRAP_BINDING_BYTES ? 0 : 1;
		for (let i = 0; i < WRAP_BINDING_BYTES; i++) {
			diff |= (plain[KEY_BYTES + i] ?? 0) ^ (want[i] ?? 0);
		}
		if (diff !== 0) failed();
		return plain.slice(0, KEY_BYTES);
	} finally {
		p.wipe(plain);
	}
}
