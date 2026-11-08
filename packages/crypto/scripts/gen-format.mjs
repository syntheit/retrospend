// Writes packages/crypto/vectors/format.vectors.json: the golden vectors for
// the sealed record format (src/format.ts, spike section 4.5).
//
// Run: node packages/crypto/scripts/gen-format.mjs
//
// Independent of the code under test and of libsodium. It rebuilds the layout
// from the spec text with its own canonical JSON, padding and base64url, and
// seals with node:crypto (OpenSSL) ChaCha20-Poly1305 behind a hand-written
// HChaCha20 (the XChaCha20 construction of draft-irtf-cfrg-xchacha). Before
// writing anything it checks that construction against the draft's own test
// vector (appendix A.3.1), so a mistake in the hand-written part stops the run.
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";

const unhex = (s) => Buffer.from(s, "hex");
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

function xchacha(key, nonce24, plaintext, aad) {
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

// Canonical JSON written from the spec sentence, not from format.ts: keys
// sorted by UTF-16 code unit, no spaces, ASCII only (every UTF-16 unit outside
// 0x20..0x7e is a lowercase \uXXXX escape). Vectors use integers only.
function canon(v) {
	if (v === null || typeof v === "boolean") return String(v);
	if (typeof v === "number") return String(v);
	if (typeof v === "string") {
		const short = {
			34: '\\"',
			92: "\\\\",
			8: "\\b",
			9: "\\t",
			10: "\\n",
			12: "\\f",
			13: "\\r",
		};
		let out = '"';
		for (let i = 0; i < v.length; i++) {
			const c = v.charCodeAt(i);
			if (short[c]) out += short[c];
			else if (c < 0x20 || c > 0x7e)
				out += `\\u${c.toString(16).padStart(4, "0")}`;
			else out += v[i];
		}
		return `${out}"`;
	}
	if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
	return `{${Object.entries(v)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, x]) => `${canon(k)}:${canon(x)}`)
		.join(",")}}`;
}

// AAD: "rs.v1|" + hex of header bytes 0..17 (version 01, algorithm 01, keyId)
// + "|userId|collectionId|entity|recordId|version".
function seal(c) {
	const aad = [
		"rs.v1",
		`0101${c.keyId}`,
		c.context.userId,
		c.context.collectionId,
		c.context.entity,
		c.context.recordId,
		c.context.version,
	].join("|");
	const json = canon(c.record);
	const body = Buffer.concat([
		Buffer.from([c.schemaVersion >> 8, c.schemaVersion & 255]),
		Buffer.from(json, "latin1"),
	]);
	const padded = Buffer.alloc((Math.floor(body.length / 64) + 1) * 64);
	body.copy(padded);
	padded[body.length] = 0x80;
	const key = unhex(c.key);
	const nonce = unhex(c.nonce);
	const sealed = Buffer.concat([
		Buffer.from([1, 1]),
		unhex(c.keyId),
		nonce,
		xchacha(key, nonce, padded, Buffer.from(aad, "latin1")),
	]);
	return {
		...c,
		aad,
		canonicalJson: json,
		paddedPlaintext: padded.toString("hex"),
		sealed: sealed.toString("hex"),
		base64url: sealed.toString("base64url"),
	};
}

const source =
	"packages/crypto/scripts/gen-format.mjs: node:crypto chacha20-poly1305 behind a hand HChaCha20 (checked against the IETF draft vector), own canonical JSON, padding and base64url";
const ids = {
	userId: "0b1f2e3d-4c5b-4a69-8877-665544332211",
	collectionId: "c0ffee00-1111-4222-8333-444455556666",
	recordId: "11112222-3333-4444-8555-666677778888",
};
const base = {
	source,
	key: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
	keyId: "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
	nonce: "404142434445464748494a4b4c4d4e4f5051525354555657",
	schemaVersion: 1,
};
const at = (entity, version) => ({ ...ids, entity, version });

const records = [
	{
		name: "expense with keys out of order",
		context: at(1, 3),
		record: {
			title: "Coffee",
			amount: { minor: 450, currency: "ARS" },
			date: "2026-11-03",
			note: null,
			refund: false,
			tags: ["a", "b"],
		},
	},
	{
		name: "non-ASCII text and escapes",
		schemaVersion: 2,
		context: at(2, 1),
		record: { title: 'Café 咖啡 😀 "q" \\ \n\tend', z: 0 },
	},
	{ name: "empty record", context: at(1, 0), record: {} },
	{
		name: "pad byte is the last byte of the bucket (61 bytes of JSON)",
		context: at(1, 3),
		record: { k: "x".repeat(53) },
	},
	{
		name: "pad byte opens a second bucket (62 bytes of JSON)",
		context: at(1, 3),
		record: { k: "x".repeat(54) },
	},
	{
		name: "large amount and negative number, other key and nonce",
		key: "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf",
		keyId: "00000000000000000000000000000001",
		nonce: "101112131415161718191a1b1c1d1e1f2021222324252627",
		context: at(65535, 9007199254740991),
		record: {
			amount: { minor: 9007199254740991, currency: "JPY" },
			delta: -12,
		},
	},
].map((r) => seal({ ...base, ...r }));

const about =
	"Golden vectors for the sealed record format (@retrospend/crypto src/format.ts), spike section 4.5. A build must reproduce `sealed` from the inputs, open it to `record`, and encode it to `base64url`. Regenerate with packages/crypto/scripts/gen-format.mjs.";
writeFileSync(
	new URL("../vectors/format.vectors.json", import.meta.url),
	`${JSON.stringify({ about, records }, null, "\t")}\n`,
);
console.log(`wrote ${records.length} format vectors`);
