import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

/**
 * Web Push message encryption (RFC 8291, content coding aes128gcm of
 * RFC 8188): the payload is readable only by the subscription's own key, so
 * a push service or a UnifiedPush distributor relays ciphertext. The device
 * registered `p256dh` (its public key) and `auth` (a 16-byte secret).
 */

const RECORD_SIZE = 4096;
const HEADER_LENGTH = 16 + 4 + 1 + 65;
/** Last-record delimiter (0x02) and the GCM tag. */
const OVERHEAD = 1 + 16;
export const MAX_WEB_PUSH_PAYLOAD = RECORD_SIZE - HEADER_LENGTH - OVERHEAD;

export class WebPushKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebPushKeyError";
	}
}

function hkdf(ikm: Buffer, salt: Buffer, info: string, length: number): Buffer {
	return Buffer.from(
		hkdfSync("sha256", ikm, salt, Buffer.from(info, "latin1"), length),
	);
}

/**
 * Encrypts `payload` for one subscription into a single aes128gcm record,
 * ready to POST. Throws WebPushKeyError for a malformed subscription key
 * and RangeError for a payload that does not fit one record.
 */
export function encryptWebPush(
	payload: Buffer,
	subscription: { p256dh: string; auth: string },
	/** The salt and sender key, fixed only to check the RFC's own test vector. */
	fixed?: { salt: Buffer; privateKey: Buffer },
): Buffer {
	if (payload.length > MAX_WEB_PUSH_PAYLOAD)
		throw new RangeError("Push payload is too large");
	const uaPublic = Buffer.from(subscription.p256dh, "base64url");
	const authSecret = Buffer.from(subscription.auth, "base64url");
	if (uaPublic.length !== 65 || uaPublic[0] !== 4)
		throw new WebPushKeyError("p256dh is not an uncompressed P-256 point");
	if (authSecret.length !== 16)
		throw new WebPushKeyError("auth is not 16 bytes");

	const ephemeral = createECDH("prime256v1");
	let asPublic: Buffer;
	if (fixed) {
		ephemeral.setPrivateKey(fixed.privateKey);
		asPublic = ephemeral.getPublicKey();
	} else asPublic = ephemeral.generateKeys();
	let shared: Buffer;
	try {
		shared = ephemeral.computeSecret(uaPublic);
	} catch {
		throw new WebPushKeyError("p256dh is not a point on P-256");
	}
	const salt = fixed?.salt ?? randomBytes(16);
	const ikm = hkdf(
		shared,
		authSecret,
		`WebPush: info\0${uaPublic.toString("latin1")}${asPublic.toString("latin1")}`,
		32,
	);
	const key = hkdf(ikm, salt, "Content-Encoding: aes128gcm\0", 16);
	const nonce = hkdf(ikm, salt, "Content-Encoding: nonce\0", 12);

	const cipher = createCipheriv("aes-128-gcm", key, nonce);
	const body = Buffer.concat([
		cipher.update(Buffer.concat([payload, Buffer.from([2])])),
		cipher.final(),
		cipher.getAuthTag(),
	]);
	const header = Buffer.alloc(HEADER_LENGTH - 65);
	salt.copy(header, 0);
	header.writeUInt32BE(RECORD_SIZE, 16);
	header[20] = 65;
	return Buffer.concat([header, asPublic, body]);
}
