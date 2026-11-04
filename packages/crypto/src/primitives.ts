// The primitives Advanced protection is built from, over libsodium. Only
// standard constructions, each used as libsodium documents it:
//   data          XChaCha20-Poly1305-IETF (24-byte random nonce is safe to draw
//                 at random, unlike the 12-byte IETF nonce)
//   password      Argon2id v1.3 (libsodium fixes parallelism at 1)
//   subkeys       crypto_kdf (keyed BLAKE2b with a context and an id)
//   public keys   X25519 sealed box (anonymous sender)
//   blind index   keyed BLAKE2b
// Nothing here stores, logs or returns more than it is asked for, and errors
// carry no data (errors.ts). The library is injected so the web (WebAssembly),
// Node and React Native (native, through JSI) builds share this one wrapper
// and one set of vectors (self-test.ts).
import { CryptoError } from "./errors";

/**
 * The slice of libsodium used here. Both `libsodium-wrappers-sumo` and
 * `react-native-libsodium` satisfy it. Two native-build limits shape it:
 * additional data must be a string (the native AEAD rejects bytes), and
 * `crypto_kx`, `crypto_scalarmult` and `memzero` do not exist there.
 */
export interface SodiumLike {
	ready: Promise<void>;
	crypto_pwhash_ALG_ARGON2ID13: number;
	randombytes_buf(length: number): Uint8Array;
	crypto_aead_xchacha20poly1305_ietf_encrypt(
		message: Uint8Array,
		additionalData: string | null,
		secretNonce: null,
		publicNonce: Uint8Array,
		key: Uint8Array,
	): Uint8Array;
	crypto_aead_xchacha20poly1305_ietf_decrypt(
		secretNonce: null,
		ciphertext: Uint8Array,
		additionalData: string | null,
		publicNonce: Uint8Array,
		key: Uint8Array,
	): Uint8Array;
	crypto_pwhash(
		keyLength: number,
		password: Uint8Array,
		salt: Uint8Array,
		opsLimit: number,
		memLimit: number,
		algorithm: number,
	): Uint8Array;
	crypto_kdf_derive_from_key(
		subkeyLength: number,
		subkeyId: number,
		context: string,
		key: Uint8Array,
	): Uint8Array;
	crypto_generichash(
		hashLength: number,
		message: Uint8Array,
		key?: Uint8Array | null,
	): Uint8Array;
	crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
	crypto_box_seed_keypair(seed: Uint8Array): {
		publicKey: Uint8Array;
		privateKey: Uint8Array;
	};
	crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
	crypto_box_seal_open(
		ciphertext: Uint8Array,
		publicKey: Uint8Array,
		privateKey: Uint8Array,
	): Uint8Array;
}

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const TAG_BYTES = 16;
export const SALT_BYTES = 16;
export const KDF_CONTEXT_BYTES = 8;
export const PUBLIC_KEY_BYTES = 32;
export const PRIVATE_KEY_BYTES = 32;
/** Bytes a sealed box adds: the ephemeral public key plus the 16-byte tag. */
export const SEAL_OVERHEAD_BYTES = 48;

/** libsodium's own bounds for an Argon2id memory limit (8 KiB) and a sane cap. */
const ARGON2_MIN_MEMORY_KIB = 8;
const ARGON2_MAX_MEMORY_KIB = 1024 * 1024;
const ARGON2_MAX_PASSES = 64;

export interface Argon2Params {
	memoryKiB: number;
	passes: number;
}

export interface BoxKeyPair {
	publicKey: Uint8Array;
	privateKey: Uint8Array;
}

const bad = (): never => {
	throw new CryptoError("invalid_input");
};
/** Realm-safe: an array made by another JS realm (a test sandbox) still counts. */
const isBytes = (v: unknown): v is Uint8Array =>
	v instanceof Uint8Array ||
	Object.prototype.toString.call(v) === "[object Uint8Array]";
const requireBytes = (v: unknown, length: number): Uint8Array =>
	isBytes(v) && v.length === length ? v : bad();
const requireInt = (v: number, min: number, max: number): number =>
	Number.isInteger(v) && v >= min && v <= max ? v : bad();
/**
 * Printable ASCII only, so the string reaches libsodium as the same bytes on
 * every platform (the native build passes strings through its own UTF-8
 * conversion). Ids, numbers and fixed labels all fit.
 */
const requireAscii = (v: string, length?: number): string =>
	typeof v === "string" &&
	/^[\x20-\x7e]*$/.test(v) &&
	(length === undefined || v.length === length)
		? v
		: bad();

/** Zero a buffer in place. Best effort: JS gives no guarantee about copies. */
export function wipe(bytes: Uint8Array): void {
	bytes.fill(0);
}

export function createPrimitives(sodium: SodiumLike) {
	const checked = (out: Uint8Array, length: number): Uint8Array =>
		isBytes(out) && out.length === length ? out : bad();

	return {
		randomBytes(length: number): Uint8Array {
			return checked(
				sodium.randombytes_buf(requireInt(length, 1, 1 << 20)),
				length,
			);
		},

		/**
		 * Encrypt and authenticate. The caller supplies the nonce so format
		 * layers can test deterministically; production callers must draw it
		 * from `randomBytes(NONCE_BYTES)` and never reuse one with a key.
		 * Returns ciphertext followed by the 16-byte tag. `aad` is bound but not
		 * encrypted: any change to it fails decryption.
		 */
		aeadEncrypt(
			key: Uint8Array,
			nonce: Uint8Array,
			plaintext: Uint8Array,
			aad: string,
		): Uint8Array {
			requireBytes(key, KEY_BYTES);
			requireBytes(nonce, NONCE_BYTES);
			if (!isBytes(plaintext)) bad();
			return checked(
				sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
					plaintext,
					requireAscii(aad),
					null,
					nonce,
					key,
				),
				plaintext.length + TAG_BYTES,
			);
		},

		/** Throws `decrypt_failed` for a wrong key, nonce, AAD or any changed byte. */
		aeadDecrypt(
			key: Uint8Array,
			nonce: Uint8Array,
			ciphertext: Uint8Array,
			aad: string,
		): Uint8Array {
			requireBytes(key, KEY_BYTES);
			requireBytes(nonce, NONCE_BYTES);
			requireAscii(aad);
			if (!isBytes(ciphertext)) bad();
			// A short input is just as unauthentic as a modified one.
			if (ciphertext.length < TAG_BYTES)
				throw new CryptoError("decrypt_failed");
			let plaintext: Uint8Array | null | undefined;
			try {
				plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
					null,
					ciphertext,
					aad,
					nonce,
					key,
				);
			} catch {
				throw new CryptoError("decrypt_failed");
			}
			if (
				!isBytes(plaintext) ||
				plaintext.length !== ciphertext.length - TAG_BYTES
			) {
				throw new CryptoError("decrypt_failed");
			}
			return plaintext;
		},

		/**
		 * Argon2id. Parameters come with each wrap so a device can derive the
		 * same key later. This function accepts any value libsodium does: the
		 * caller that reads them from the server must check a minimum first
		 * (a hostile server could otherwise return weak ones).
		 */
		argon2id(
			password: Uint8Array,
			salt: Uint8Array,
			params: Argon2Params,
			length = KEY_BYTES,
		): Uint8Array {
			if (!isBytes(password) || password.length === 0) bad();
			requireBytes(salt, SALT_BYTES);
			requireInt(
				params.memoryKiB,
				ARGON2_MIN_MEMORY_KIB,
				ARGON2_MAX_MEMORY_KIB,
			);
			requireInt(params.passes, 1, ARGON2_MAX_PASSES);
			requireInt(length, 16, 64);
			return checked(
				sodium.crypto_pwhash(
					length,
					password,
					salt,
					params.passes,
					params.memoryKiB * 1024,
					sodium.crypto_pwhash_ALG_ARGON2ID13,
				),
				length,
			);
		},

		/**
		 * Derive an independent subkey from a 32-byte master key. The 8-character
		 * `context` names the purpose ("auth", "wrap" and so on, fixed in code),
		 * `subkeyId` separates keys of one purpose.
		 */
		kdfDerive(
			masterKey: Uint8Array,
			subkeyId: number,
			context: string,
			length = KEY_BYTES,
		): Uint8Array {
			requireBytes(masterKey, KEY_BYTES);
			// libsodium.js 0.8.4 refuses ids from 2^31 up, so the shared range stops there.
			requireInt(subkeyId, 0, 0x7fffffff);
			requireAscii(context, KDF_CONTEXT_BYTES);
			requireInt(length, 16, 64);
			return checked(
				sodium.crypto_kdf_derive_from_key(length, subkeyId, context, masterKey),
				length,
			);
		},

		/** BLAKE2b; with a key it is a MAC, used for blind indexes. */
		blake2b(message: Uint8Array, length: number, key?: Uint8Array): Uint8Array {
			if (!isBytes(message)) bad();
			requireInt(length, 16, 64);
			if (key !== undefined) requireInt(key.length, 16, 64);
			return checked(sodium.crypto_generichash(length, message, key), length);
		},

		/** A fresh X25519 key pair. */
		boxKeypair(): BoxKeyPair {
			const pair = sodium.crypto_box_keypair();
			return {
				publicKey: checked(pair.publicKey, PUBLIC_KEY_BYTES),
				privateKey: checked(pair.privateKey, PRIVATE_KEY_BYTES),
			};
		},

		/**
		 * The same key pair every time for one 32-byte seed (private key is
		 * SHA-512(seed)[0..32]). Lets a key pair be re-derived from a stored
		 * secret without `crypto_scalarmult`, which the native build lacks.
		 */
		boxKeypairFromSeed(seed: Uint8Array): BoxKeyPair {
			const pair = sodium.crypto_box_seed_keypair(
				requireBytes(seed, KEY_BYTES),
			);
			return {
				publicKey: checked(pair.publicKey, PUBLIC_KEY_BYTES),
				privateKey: checked(pair.privateKey, PRIVATE_KEY_BYTES),
			};
		},

		/**
		 * Encrypt to a public key; only its private key opens it. The sender is
		 * anonymous (a one-time key is made and discarded), so this proves
		 * nothing about who sealed it: bind identity in the plaintext or AAD of
		 * whatever carries it.
		 */
		seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array {
			if (!isBytes(message)) bad();
			return checked(
				sodium.crypto_box_seal(
					message,
					requireBytes(publicKey, PUBLIC_KEY_BYTES),
				),
				message.length + SEAL_OVERHEAD_BYTES,
			);
		},

		/** Throws `decrypt_failed` for the wrong key pair or a changed byte. */
		sealOpen(
			ciphertext: Uint8Array,
			publicKey: Uint8Array,
			privateKey: Uint8Array,
		): Uint8Array {
			requireBytes(publicKey, PUBLIC_KEY_BYTES);
			requireBytes(privateKey, PRIVATE_KEY_BYTES);
			if (!isBytes(ciphertext)) bad();
			if (ciphertext.length < SEAL_OVERHEAD_BYTES) {
				throw new CryptoError("decrypt_failed");
			}
			let plaintext: Uint8Array | null | undefined;
			try {
				plaintext = sodium.crypto_box_seal_open(
					ciphertext,
					publicKey,
					privateKey,
				);
			} catch {
				throw new CryptoError("decrypt_failed");
			}
			if (
				!isBytes(plaintext) ||
				plaintext.length !== ciphertext.length - SEAL_OVERHEAD_BYTES
			) {
				throw new CryptoError("decrypt_failed");
			}
			return plaintext;
		},

		wipe,
	};
}

export type Primitives = ReturnType<typeof createPrimitives>;
