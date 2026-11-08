// Shared by the vector generators: XChaCha20-Poly1305 built from node:crypto
// ChaCha20-Poly1305 and a hand-written HChaCha20, checked against the IETF
// draft vector (appendix A.3.1) every time it loads.
import crypto from "node:crypto";

export const unhex = (s) => Buffer.from(s, "hex");
const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

function hchacha20(key, nonce16) {
	const s = new Uint32Array(16);
	s.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
	for (let i = 0; i < 8; i++) s[4 + i] = key.readUInt32LE(i * 4);
	for (let i = 0; i < 4; i++) s[12 + i] = nonce16.readUInt32LE(i * 4);
	const qr = (a, b, c, d) => {
		s[a] = (s[a] + s[b]) >>> 0;
		s[d] = rotl(s[d] ^ s[a], 16);
		s[c] = (s[c] + s[d]) >>> 0;
		s[b] = rotl(s[b] ^ s[c], 12);
		s[a] = (s[a] + s[b]) >>> 0;
		s[d] = rotl(s[d] ^ s[a], 8);
		s[c] = (s[c] + s[d]) >>> 0;
		s[b] = rotl(s[b] ^ s[c], 7);
	};
	for (let i = 0; i < 10; i++) {
		qr(0, 4, 8, 12);
		qr(1, 5, 9, 13);
		qr(2, 6, 10, 14);
		qr(3, 7, 11, 15);
		qr(0, 5, 10, 15);
		qr(1, 6, 11, 12);
		qr(2, 7, 8, 13);
		qr(3, 4, 9, 14);
	}
	const out = Buffer.alloc(32);
	for (let i = 0; i < 4; i++) out.writeUInt32LE(s[i], i * 4);
	for (let i = 0; i < 4; i++) out.writeUInt32LE(s[12 + i], 16 + i * 4);
	return out;
}

export function xchacha(key, nonce24, plaintext, aad) {
	const subkey = hchacha20(key, nonce24.subarray(0, 16));
	const nonce12 = Buffer.concat([Buffer.alloc(4), nonce24.subarray(16)]);
	const c = crypto.createCipheriv("chacha20-poly1305", subkey, nonce12, {
		authTagLength: 16,
	});
	c.setAAD(aad, { plaintextLength: plaintext.length });
	return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

// draft-irtf-cfrg-xchacha-03 appendix A.3.1, verbatim.
const draft = xchacha(
	unhex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f"),
	unhex("404142434445464748494a4b4c4d4e4f5051525354555657"),
	Buffer.from(
		"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
	),
	unhex("50515253c0c1c2c3c4c5c6c7"),
);
if (
	draft.toString("hex") !==
	"bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49"
) {
	throw new Error("hand XChaCha20 does not match the IETF draft vector");
}
