// The key hierarchy for Advanced protection (spike section 4.4). Everything
// here is a pure function of its inputs plus the injected primitives; nothing
// stores, sends or logs a key. Errors are CryptoError with fixed text.
//
//   password --Argon2id(salt, params)--> master key (MK, never stored)
//   MK --kdf "rs.mk.v1" id 1--> auth key   (sent to better-auth as the password)
//   MK --kdf "rs.mk.v1" id 2--> password wrapping key
//   recovery key (RK, 32 random bytes) --kdf "rs.rk.v1" id 1--> recovery wrapping key
//   account key (AK, 32 random bytes) is wrapped by the password wrapping key,
//       the recovery wrapping key, and (sealed to a public key) each device
//       and trusted contact
//   AK wraps the account private key and every collection key
//   collection key: 32 random bytes plus a random 16-byte keyId (RecordKey in
//       format.ts), one per collection and key version
//
// KDF contexts are 8 ASCII characters, ids stay below 2^31 (the native build
// refuses more). "rs.ak.v1" is reserved for keys derived from AK later.
//
// Wrapped key formats (raw bytes; callers encode with toBase64Url):
//   symmetric  01 01 | nonce (24) | AEAD(wrapping key, plaintext = the 32-byte key)
//   to public  01 02 | sealed box (plaintext = key | BLAKE2b-16 of the AAD text)
//   AAD text   "rs.wrap.v1|<first two bytes as hex>|<role>|<id>"
// The AAD binds what a key is for (role) and which one it is (id: the user id
// for AK and the private key, the keyId in hex for a collection key, the
// device or contact id for those). The server can store, withhold and replay
// wraps but cannot present one as another role or id. A sealed box has no
// sender, so anyone can seal to a public key: the binding stops swaps of
// genuine wraps, and trust in the public key itself comes from comparing
// fingerprintPhrase out of band.
//
// REQUIREMENT before device or contact unlock ships: public-key wraps
// (ak-device, ak-contact) do NOT authenticate the account key. Anyone with the
// recipient's public key, the server included, can seal any 32 bytes for that
// role and id, and a substitute AK that also comes with a matching private-key
// wrap and collection-key wraps is not detected by the recipient. Either the
// device pins a commitment to AK when it is approved (for example BLAKE2b of
// AK in secure storage, checked on every unwrap), or the approving device
// authenticates the wrap (crypto_box with its static key). One of the two must
// be built with the device flow.
//
// Recovery key text: 32 bytes then the 4-bit version 1 make 260 bits, written
// as 52 symbols of the Crockford base32 alphabet 0123456789ABCDEFGHJKMNPQRSTVWXYZ
// (most significant bit first), then two check symbols, 54 in all, shown as
// nine groups of six joined by "-". With the symbols as elements of GF(32)
// (polynomial x^5 + x^2 + 1, a = x), check 1 is the sum of the data symbols and
// check 2 is the sum of a^i * d_i (i from 0). Every single wrong symbol and
// every swap of two adjacent different symbols is caught: a change of one
// symbol moves check 1 (or is a check symbol itself), a swap leaves check 1 and
// moves check 2 by (x+y)*a^i*(1+a), or breaks the equal-to-check-1 test at the
// last data symbol and the first check. Input is read case-insensitively,
// ignoring spaces and "-", with O read as 0 and I and L as 1 (Crockford).
import { CryptoError } from "./errors";
import { KEY_ID_BYTES, type RecordKey } from "./format";
import { toHex } from "./hex";
import {
	type Argon2Params,
	type BoxKeyPair,
	KEY_BYTES,
	NONCE_BYTES,
	type Primitives,
	SALT_BYTES,
	TAG_BYTES,
} from "./primitives";

export const ARGON2_DEFAULT: Argon2Params = { memoryKiB: 64 * 1024, passes: 3 };
/** Never derive with less (OWASP: 46 MiB and one pass). Checked before any work. */
export const ARGON2_FLOOR: Argon2Params = { memoryKiB: 46 * 1024, passes: 1 };
/** A server cannot make a phone allocate or spin more than this. */
export const ARGON2_CEILING: Argon2Params = {
	memoryKiB: 256 * 1024,
	passes: 10,
};

export const CONTEXT_MASTER = "rs.mk.v1";
export const CONTEXT_RECOVERY = "rs.rk.v1";
export const SUBKEY_AUTH = 1;
export const SUBKEY_PASSWORD_WRAP = 2;
export const SUBKEY_RECOVERY_WRAP = 1;

export const SYMMETRIC_ROLES = [
	"ak-password",
	"ak-recovery",
	"collection-key",
	"private-key",
] as const;
export const PUBLIC_ROLES = ["ak-device", "ak-contact"] as const;
export type SymmetricRole = (typeof SYMMETRIC_ROLES)[number];
export type PublicRole = (typeof PUBLIC_ROLES)[number];

const WRAP_VERSION = 1;
const WRAP_SYMMETRIC = 1;
const WRAP_TO_PUBLIC = 2;
const BINDING_BYTES = 16;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const bad = (): never => {
	throw new CryptoError("invalid_input");
};
const failed = (): never => {
	throw new CryptoError("decrypt_failed");
};

/** Throws `invalid_input` unless the parameters are within the floor and ceiling. */
export function checkArgon2Params(params: Argon2Params): Argon2Params {
	if (
		!Number.isInteger(params.memoryKiB) ||
		!Number.isInteger(params.passes) ||
		params.memoryKiB < ARGON2_FLOOR.memoryKiB ||
		params.memoryKiB > ARGON2_CEILING.memoryKiB ||
		params.passes < ARGON2_FLOOR.passes ||
		params.passes > ARGON2_CEILING.passes
	) {
		bad();
	}
	return params;
}

/** NFKC, then UTF-8 without TextEncoder so every runtime gives the same bytes. */
function passwordBytes(password: string): Uint8Array {
	if (typeof password !== "string") bad();
	const text = password.normalize("NFKC");
	const buffer = new Uint8Array(text.length * 3);
	let n = 0;
	for (const ch of text) {
		const c = ch.codePointAt(0) as number;
		if (c >= 0xd800 && c <= 0xdfff) bad();
		if (c < 0x80) buffer[n++] = c;
		else if (c < 0x800) {
			buffer[n++] = 0xc0 | (c >> 6);
			buffer[n++] = 0x80 | (c & 63);
		} else if (c < 0x10000) {
			buffer[n++] = 0xe0 | (c >> 12);
			buffer[n++] = 0x80 | ((c >> 6) & 63);
			buffer[n++] = 0x80 | (c & 63);
		} else {
			buffer[n++] = 0xf0 | (c >> 18);
			buffer[n++] = 0x80 | ((c >> 12) & 63);
			buffer[n++] = 0x80 | ((c >> 6) & 63);
			buffer[n++] = 0x80 | (c & 63);
		}
	}
	const out = buffer.slice(0, n);
	buffer.fill(0);
	return out;
}

/**
 * The master key. `params` come from the server with the salt, so they are
 * checked first: a hostile server must not be able to make the auth key (and
 * so the password) cheap to guess.
 */
export function deriveMasterKey(
	p: Primitives,
	password: string,
	salt: Uint8Array,
	params: Argon2Params,
): Uint8Array {
	if (salt.length !== SALT_BYTES) bad();
	checkArgon2Params(params);
	const bytes = passwordBytes(password);
	try {
		return p.argon2id(bytes, salt, params);
	} finally {
		p.wipe(bytes);
	}
}

export function masterSubkeys(p: Primitives, masterKey: Uint8Array) {
	return {
		authKey: p.kdfDerive(masterKey, SUBKEY_AUTH, CONTEXT_MASTER),
		wrapKey: p.kdfDerive(masterKey, SUBKEY_PASSWORD_WRAP, CONTEXT_MASTER),
	};
}

export const generateAccountKey = (p: Primitives): Uint8Array =>
	p.randomBytes(KEY_BYTES);
export const generateRecoveryKey = generateAccountKey;
export const generateCollectionKey = (p: Primitives): RecordKey => ({
	keyId: p.randomBytes(KEY_ID_BYTES),
	key: p.randomBytes(KEY_BYTES),
});
export const recoveryWrapKey = (p: Primitives, recoveryKey: Uint8Array) =>
	p.kdfDerive(recoveryKey, SUBKEY_RECOVERY_WRAP, CONTEXT_RECOVERY);

// Wrapping.

const wrapAad = (alg: number, role: string, id: string): string => {
	if (!ID.test(id)) bad();
	return `rs.wrap.v1|${toHex(Uint8Array.of(WRAP_VERSION, alg))}|${role}|${id}`;
};
const ascii = (text: string): Uint8Array =>
	Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const oneOf = <T extends string>(list: readonly T[], role: string): T =>
	list.includes(role as T) ? (role as T) : bad();

/** Seals with a caller-chosen nonce, for vectors only (not in the index). */
export function wrapKeyWithNonce(
	p: Primitives,
	wrappingKey: Uint8Array,
	role: SymmetricRole,
	id: string,
	key: Uint8Array,
	nonce: Uint8Array,
): Uint8Array {
	if (key.length !== KEY_BYTES) bad();
	const aad = wrapAad(WRAP_SYMMETRIC, oneOf(SYMMETRIC_ROLES, role), id);
	const encrypted = p.aeadEncrypt(wrappingKey, nonce, key, aad);
	const out = new Uint8Array(2 + NONCE_BYTES + encrypted.length);
	out.set([WRAP_VERSION, WRAP_SYMMETRIC]);
	out.set(nonce, 2);
	out.set(encrypted, 2 + NONCE_BYTES);
	return out;
}

export const wrapKey = (
	p: Primitives,
	wrappingKey: Uint8Array,
	role: SymmetricRole,
	id: string,
	key: Uint8Array,
) =>
	wrapKeyWithNonce(p, wrappingKey, role, id, key, p.randomBytes(NONCE_BYTES));

/**
 * `invalid_input` for a version or algorithm this build does not know,
 * `decrypt_failed` for a wrong key, role or id or any changed byte.
 */
export function unwrapKey(
	p: Primitives,
	wrappingKey: Uint8Array,
	role: SymmetricRole,
	id: string,
	wrapped: Uint8Array,
): Uint8Array {
	const aad = wrapAad(WRAP_SYMMETRIC, oneOf(SYMMETRIC_ROLES, role), id);
	if (wrapped.length < 2) failed();
	if (wrapped[0] !== WRAP_VERSION || wrapped[1] !== WRAP_SYMMETRIC) bad();
	if (wrapped.length !== 2 + NONCE_BYTES + KEY_BYTES + TAG_BYTES) failed();
	return p.aeadDecrypt(
		wrappingKey,
		wrapped.slice(2, 2 + NONCE_BYTES),
		wrapped.subarray(2 + NONCE_BYTES),
		aad,
	);
}

export function wrapKeyToPublic(
	p: Primitives,
	publicKey: Uint8Array,
	role: PublicRole,
	id: string,
	key: Uint8Array,
): Uint8Array {
	if (key.length !== KEY_BYTES) bad();
	const aad = wrapAad(WRAP_TO_PUBLIC, oneOf(PUBLIC_ROLES, role), id);
	const plain = new Uint8Array(KEY_BYTES + BINDING_BYTES);
	plain.set(key);
	plain.set(p.blake2b(ascii(aad), BINDING_BYTES), KEY_BYTES);
	try {
		const sealed = p.seal(plain, publicKey);
		const out = new Uint8Array(2 + sealed.length);
		out.set([WRAP_VERSION, WRAP_TO_PUBLIC]);
		out.set(sealed, 2);
		return out;
	} finally {
		p.wipe(plain);
	}
}

export function unwrapKeyFromPublic(
	p: Primitives,
	pair: BoxKeyPair,
	role: PublicRole,
	id: string,
	wrapped: Uint8Array,
): Uint8Array {
	const aad = wrapAad(WRAP_TO_PUBLIC, oneOf(PUBLIC_ROLES, role), id);
	if (wrapped.length < 2) failed();
	if (wrapped[0] !== WRAP_VERSION || wrapped[1] !== WRAP_TO_PUBLIC) bad();
	const plain = p.sealOpen(
		wrapped.subarray(2),
		pair.publicKey,
		pair.privateKey,
	);
	try {
		const want = p.blake2b(ascii(aad), BINDING_BYTES);
		let diff = plain.length === KEY_BYTES + BINDING_BYTES ? 0 : 1;
		for (let i = 0; i < BINDING_BYTES; i++) {
			diff |= (plain[KEY_BYTES + i] ?? 0) ^ (want[i] ?? 0);
		}
		if (diff !== 0) failed();
		return plain.slice(0, KEY_BYTES);
	} finally {
		p.wipe(plain);
	}
}

/**
 * True if the private key opens what the public key seals. Run after
 * unwrapping the account private key beside the stored public key: a server
 * that swapped the public key is caught here (the fingerprint phrase covers
 * the rest).
 */
export function keyPairMatches(p: Primitives, pair: BoxKeyPair): boolean {
	const probe = p.randomBytes(KEY_BYTES);
	try {
		const opened = p.sealOpen(
			p.seal(probe, pair.publicKey),
			pair.publicKey,
			pair.privateKey,
		);
		return opened.every((byte, i) => byte === probe[i]);
	} catch {
		return false;
	}
}

// Recovery key text.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RK_VERSION = 1;
const RK_DATA_SYMBOLS = 52;
const RK_GROUP = 6;

const mulAlpha = (v: number) => ((v << 1) ^ (v & 16 ? 0x25 : 0)) & 31;

function checkSymbols(data: readonly number[]): [number, number] {
	let sum = 0;
	let weighted = 0;
	for (let i = data.length - 1; i >= 0; i--) {
		sum ^= data[i] as number;
		weighted = mulAlpha(weighted) ^ (data[i] as number);
	}
	return [sum, weighted];
}

export function encodeRecoveryKey(key: Uint8Array): string {
	if (key.length !== KEY_BYTES) bad();
	const symbols: number[] = [];
	let acc = 0;
	let held = 0;
	const feed = (value: number, bits: number) => {
		acc = (acc << bits) | value;
		held += bits;
		while (held >= 5) {
			held -= 5;
			symbols.push((acc >> held) & 31);
		}
		acc &= (1 << held) - 1;
	};
	for (const byte of key) feed(byte, 8);
	feed(RK_VERSION, 4);
	symbols.push(...checkSymbols(symbols));
	const text = symbols.map((s) => ALPHABET.charAt(s)).join("");
	return text.match(new RegExp(`.{${RK_GROUP}}`, "g"))?.join("-") ?? bad();
}

/** `invalid_input` for a wrong length, a stray character, a typo or an unknown version. */
export function parseRecoveryKey(text: string): Uint8Array {
	if (typeof text !== "string" || !/^[\t\n\r\x20-\x7e]*$/.test(text)) bad();
	const clean = text
		.toUpperCase()
		.replace(/[\s-]/g, "")
		.replace(/O/g, "0")
		.replace(/[IL]/g, "1");
	if (clean.length !== RK_DATA_SYMBOLS + 2) bad();
	const symbols = [...clean].map((ch) => ALPHABET.indexOf(ch));
	if (symbols.includes(-1)) bad();
	const data = symbols.slice(0, RK_DATA_SYMBOLS);
	const [sum, weighted] = checkSymbols(data);
	if (
		sum !== symbols[RK_DATA_SYMBOLS] ||
		weighted !== symbols[RK_DATA_SYMBOLS + 1]
	) {
		bad();
	}
	const out = new Uint8Array(KEY_BYTES);
	let acc = 0;
	let held = 0;
	let n = 0;
	for (const s of data) {
		acc = (acc << 5) | s;
		held += 5;
		if (held >= 8 && n < KEY_BYTES) {
			held -= 8;
			out[n++] = (acc >> held) & 255;
			acc &= (1 << held) - 1;
		}
	}
	if (acc !== RK_VERSION) bad();
	return out;
}

// Fingerprint phrase.

const CONSONANTS = "bdfghjklmnprstvz";
const VOWELS = "aiou";

/** Proquints (Wilkerson 2009): 16 bits as consonant, vowel, consonant, vowel, consonant. */
export function encodeProquint(bytes: Uint8Array): string[] {
	if (bytes.length === 0 || bytes.length % 2 !== 0) bad();
	const words: string[] = [];
	for (let i = 0; i < bytes.length; i += 2) {
		const w = ((bytes[i] as number) << 8) | (bytes[i + 1] as number);
		words.push(
			CONSONANTS.charAt(w >> 12) +
				VOWELS.charAt((w >> 10) & 3) +
				CONSONANTS.charAt((w >> 6) & 15) +
				VOWELS.charAt((w >> 4) & 3) +
				CONSONANTS.charAt(w & 15),
		);
	}
	return words;
}

/**
 * Six pronounceable words (96 bits) that two people compare aloud to confirm
 * they hold the same public key (or, for device approval, the same pair of
 * keys, passed in an order both sides agree on). It is the first 12 bytes of
 * BLAKE2b with a 16-byte output over "rs.fp.v1" and the keys in order.
 */
export function fingerprintPhrase(
	p: Primitives,
	publicKeys: Uint8Array[],
): string {
	if (publicKeys.length === 0) bad();
	const label = ascii("rs.fp.v1");
	const message = new Uint8Array(label.length + publicKeys.length * KEY_BYTES);
	message.set(label);
	publicKeys.forEach((key, i) => {
		if (key.length !== KEY_BYTES) bad();
		message.set(key, label.length + i * KEY_BYTES);
	});
	return encodeProquint(p.blake2b(message, 16).subarray(0, 12)).join(" ");
}
