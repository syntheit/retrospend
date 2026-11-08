// Unpadded base64url (RFC 4648 section 5), written out so the wire form does
// not depend on btoa, Buffer or a platform codec. Decoding is strict: one
// text per byte string, so a re-encoded record is byte-identical.
const ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charAt(i)] = i;

export function toBase64Url(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const n =
			((bytes[i] ?? 0) << 16) |
			((bytes[i + 1] ?? 0) << 8) |
			(bytes[i + 2] ?? 0);
		out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
		if (i + 1 < bytes.length) out += ALPHABET.charAt((n >> 6) & 63);
		if (i + 2 < bytes.length) out += ALPHABET.charAt(n & 63);
	}
	return out;
}

/** Returns null for anything that is not canonical unpadded base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
	if (typeof text !== "string" || text.length % 4 === 1) return null;
	const out = new Uint8Array(Math.floor((text.length * 3) / 4));
	let bits = 0;
	let acc = 0;
	let at = 0;
	for (let i = 0; i < text.length; i++) {
		const v = LOOKUP[text.charAt(i)];
		if (v === undefined) return null;
		acc = (acc << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[at++] = (acc >> bits) & 255;
		}
	}
	// Leftover bits must be zero, or two texts would decode to the same bytes.
	if ((acc & ((1 << bits) - 1)) !== 0) return null;
	return out;
}
