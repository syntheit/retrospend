// Writes packages/crypto/vectors/keys.vectors.json: known answers for the key
// hierarchy (src/keys.ts, spike section 4.4).
//
// Run: node packages/crypto/scripts/gen-keys.mjs
//
// Independent of the code under test and of libsodium. Everything is rebuilt
// from the format text at the top of keys.ts:
//   Argon2id        node:crypto argon2Sync (OpenSSL)
//   BLAKE2b, kdf    python3 hashlib.blake2b (key, salt, person), the layout of
//                   libsodium's crypto_kdf_blake2b
//   XChaCha20       lib.mjs (OpenSSL ChaCha20-Poly1305 behind a hand HChaCha20)
//   X25519          node:crypto
//   sealed box      hand HSalsa20, Salsa20 and Poly1305 (BigInt), nonce from
//                   BLAKE2b, with a fixed ephemeral key so the output repeats
//   recovery text   hand GF(32) log tables (a different route from the Horner
//                   form in keys.ts) and BigInt bit slicing
//   proquint        written from the published description
// Before writing anything every hand-written part is checked against vectors
// that are not ours: RFC 9106 (Argon2id), RFC 7693 (BLAKE2b), the proquint
// reference examples, and the F1 sealed-box vector made by other code. Any
// mismatch stops the run.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { unhex, xchacha } from "./lib.mjs";

const hex = (b) => Buffer.from(b).toString("hex");
const check = (what, got, want) => {
	if (got !== want) throw new Error(`self-check failed: ${what}`);
};

// BLAKE2b via python3 hashlib. Arguments are hex strings.
const PY = `
import sys, json, hashlib
a = json.load(sys.stdin)
h = hashlib.blake2b(bytes.fromhex(a["msg"]), digest_size=a["size"], key=bytes.fromhex(a["key"]), salt=bytes.fromhex(a["salt"]), person=bytes.fromhex(a["person"]))
print(h.hexdigest())`;
const blake2b = (msgHex, size, { key = "", salt = "", person = "" } = {}) =>
	execFileSync("python3", ["-I", "-c", PY], {
		input: JSON.stringify({ msg: msgHex, size, key, salt, person }),
	})
		.toString()
		.trim();
const ascii = (s) => Buffer.from(s, "latin1").toString("hex");

check(
	"BLAKE2b RFC 7693 appendix A",
	blake2b(ascii("abc"), 64),
	"ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
);

// crypto_kdf_blake2b: BLAKE2b(empty message, key = master, salt = LE64(id) padded
// to 16 bytes, personal = context padded to 16 bytes), output = subkey length.
const kdf = (masterHex, id, context, length = 32) => {
	if (context.length !== 8) throw new Error("context must be 8 characters");
	const salt = Buffer.alloc(16);
	salt.writeBigUInt64LE(BigInt(id));
	const person = Buffer.alloc(16);
	person.write(context, "latin1");
	return blake2b("", length, {
		key: masterHex,
		salt: hex(salt),
		person: hex(person),
	});
};
// The F1 vectors for the same construction were made separately (python in the
// first place): reproduce one of them.
const f1 = JSON.parse(
	readFileSync(new URL("../vectors/primitives.vectors.json", import.meta.url)),
);
for (const v of f1.kdf) {
	check(
		`kdf against F1 vector ${v.name}`,
		kdf(v.masterKey, v.subkeyId, v.context, v.length),
		v.output,
	);
}

// Argon2id.
const argon = (password, salt, memoryKiB, passes) =>
	crypto
		.argon2Sync("argon2id", {
			message: password,
			nonce: salt,
			parallelism: 1,
			tagLength: 32,
			memory: memoryKiB,
			passes,
		})
		.toString("hex");
// RFC 9106 section 5.3 (4 lanes, secret and associated data).
check(
	"Argon2id RFC 9106 5.3",
	crypto
		.argon2Sync("argon2id", {
			message: Buffer.alloc(32, 1),
			nonce: Buffer.alloc(16, 2),
			secret: Buffer.alloc(8, 3),
			associatedData: Buffer.alloc(12, 4),
			parallelism: 4,
			tagLength: 32,
			memory: 32,
			passes: 3,
		})
		.toString("hex"),
	"0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
);

// Salsa20 family, for the sealed box.
const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
const add = (a, b) => (a + b) >>> 0;
function salsaRounds(x) {
	const qr = (a, b, c, d) => {
		x[b] ^= rotl(add(x[a], x[d]), 7);
		x[c] ^= rotl(add(x[b], x[a]), 9);
		x[d] ^= rotl(add(x[c], x[b]), 13);
		x[a] ^= rotl(add(x[d], x[c]), 18);
	};
	for (let i = 0; i < 10; i++) {
		qr(0, 4, 8, 12); // columns
		qr(5, 9, 13, 1);
		qr(10, 14, 2, 6);
		qr(15, 3, 7, 11);
		qr(0, 1, 2, 3); // rows
		qr(5, 6, 7, 4);
		qr(10, 11, 8, 9);
		qr(15, 12, 13, 14);
	}
}
const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
function salsaState(key, in16) {
	const x = new Uint32Array(16);
	x[0] = SIGMA[0];
	x[5] = SIGMA[1];
	x[10] = SIGMA[2];
	x[15] = SIGMA[3];
	for (let i = 0; i < 4; i++) {
		x[1 + i] = key.readUInt32LE(i * 4);
		x[11 + i] = key.readUInt32LE(16 + i * 4);
		x[6 + i] = in16.readUInt32LE(i * 4);
	}
	return x;
}
function hsalsa20(key, in16) {
	const x = salsaState(key, in16);
	salsaRounds(x);
	const out = Buffer.alloc(32);
	[0, 5, 10, 15, 6, 7, 8, 9].forEach((w, i) => {
		out.writeUInt32LE(x[w], i * 4);
	});
	return out;
}
function salsa20Block(key, nonce8, counter) {
	const in16 = Buffer.concat([nonce8, Buffer.alloc(8)]);
	in16.writeBigUInt64LE(BigInt(counter), 8);
	const x = salsaState(key, in16);
	const start = Uint32Array.from(x);
	salsaRounds(x);
	const out = Buffer.alloc(64);
	for (let i = 0; i < 16; i++) out.writeUInt32LE(add(x[i], start[i]), i * 4);
	return out;
}
function xsalsaStream(key, nonce24, length) {
	const sub = hsalsa20(key, nonce24.subarray(0, 16));
	const blocks = [];
	for (let c = 0; c * 64 < length; c++) {
		blocks.push(salsa20Block(sub, nonce24.subarray(16), c));
	}
	return Buffer.concat(blocks).subarray(0, length);
}
function poly1305(key32, msg) {
	const le = (b) =>
		BigInt(`0x${Buffer.from(b).reverse().toString("hex") || "0"}`);
	const r = le(key32.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
	const p = (1n << 130n) - 5n;
	let acc = 0n;
	for (let i = 0; i < msg.length; i += 16) {
		const chunk = msg.subarray(i, i + 16);
		acc = ((acc + le(chunk) + (1n << BigInt(8 * chunk.length))) * r) % p;
	}
	const tag = (acc + le(key32.subarray(16))) & ((1n << 128n) - 1n);
	return Buffer.from(tag.toString(16).padStart(32, "0"), "hex").reverse();
}
// crypto_secretbox: block 0 of the stream gives the Poly1305 key (first 32
// bytes), the message is XORed from byte 32 on; output is the tag, then data.
function secretbox(key, nonce24, msg) {
	const stream = xsalsaStream(key, nonce24, 32 + msg.length);
	const ct = Buffer.from(msg.map((b, i) => b ^ stream[32 + i]));
	return Buffer.concat([poly1305(stream.subarray(0, 32), ct), ct]);
}
function secretboxOpen(key, nonce24, boxed) {
	const stream = xsalsaStream(key, nonce24, 32 + boxed.length - 16);
	const ct = boxed.subarray(16);
	if (!poly1305(stream.subarray(0, 32), ct).equals(boxed.subarray(0, 16))) {
		throw new Error("bad tag");
	}
	return Buffer.from(ct.map((b, i) => b ^ stream[32 + i]));
}

// X25519 through node:crypto.
const PKCS8 = unhex("302e020100300506032b656e04220420");
const SPKI = unhex("302a300506032b656e032100");
const privObj = (sk) =>
	crypto.createPrivateKey({
		key: Buffer.concat([PKCS8, sk]),
		format: "der",
		type: "pkcs8",
	});
const pubObj = (pk) =>
	crypto.createPublicKey({
		key: Buffer.concat([SPKI, pk]),
		format: "der",
		type: "spki",
	});
const x25519Public = (sk) =>
	crypto
		.createPublicKey(privObj(sk))
		.export({ format: "der", type: "spki" })
		.subarray(12);
const x25519 = (sk, pk) =>
	crypto.diffieHellman({ privateKey: privObj(sk), publicKey: pubObj(pk) });
// crypto_box_seed_keypair: private key = SHA-512(seed)[0..32] (stored unclamped).
const seedPair = (seed) => {
	const sk = crypto.createHash("sha512").update(seed).digest().subarray(0, 32);
	return { sk, pk: x25519Public(sk) };
};
const boxKey = (sk, pk) => hsalsa20(x25519(sk, pk), Buffer.alloc(16));
// crypto_box_seal: epk | box(msg, nonce = BLAKE2b-24(epk | rpk), esk -> rpk).
const sealedBox = (msg, rpk, esk) => {
	const epk = x25519Public(esk);
	const nonce = unhex(blake2b(hex(Buffer.concat([epk, rpk])), 24));
	return Buffer.concat([epk, secretbox(boxKey(esk, rpk), nonce, msg)]);
};
const sealedBoxOpen = (sealed, rsk, rpk) => {
	const epk = sealed.subarray(0, 32);
	const nonce = unhex(blake2b(hex(Buffer.concat([epk, rpk])), 24));
	return secretboxOpen(boxKey(rsk, epk), nonce, sealed.subarray(32));
};
// The F1 vectors came from other code: our seed pair and our box must agree.
for (const v of f1.boxSeed) {
	const pair = seedPair(unhex(v.seed));
	check(
		`box seed pair ${v.name}`,
		`${hex(pair.pk)}:${hex(pair.sk)}`,
		`${v.publicKey}:${v.privateKey}`,
	);
}
for (const v of f1.seal) {
	check(
		`sealed box opens F1 vector ${v.name}`,
		hex(
			sealedBoxOpen(
				unhex(v.ciphertext),
				unhex(v.privateKey),
				unhex(v.publicKey),
			),
		),
		v.plaintext,
	);
}

// Proquint, from the published description: 16 bits as con(4) vowel(2)
// con(4) vowel(2) con(4), most significant first.
const proquint = (bytes) => {
	const C = "bdfghjklmnprstvz";
	const V = "aiou";
	const words = [];
	for (let i = 0; i < bytes.length; i += 2) {
		const w = bytes[i] * 256 + bytes[i + 1];
		const bits = w.toString(2).padStart(16, "0");
		const part = (from, n) => Number.parseInt(bits.slice(from, from + n), 2);
		words.push(
			C[part(0, 4)] +
				V[part(4, 2)] +
				C[part(6, 4)] +
				V[part(10, 2)] +
				C[part(12, 4)],
		);
	}
	return words;
};
const published = {
	"7f000001": "lusab-babad",
	"3f54dcc1": "gutih-tugad",
	"3f760723": "gutuk-bisog",
	"8c62c18d": "mudof-sakat",
	"40ff06c8": "haguz-biram",
	"801e342d": "mabiv-gibot",
	93437702: "natag-lisaf",
	d82344d7: "tobog-higil",
	d844e815: "todah-vobij",
	c6518188: "sinid-makam",
	"0c6e6ecc": "budov-kuras",
};
for (const [h, want] of Object.entries(published)) {
	check(`proquint ${want}`, proquint(unhex(h)).join("-"), want);
}

// Recovery key text, from the format text: GF(32) built from x^5 + x^2 + 1.
const exp = [];
const log = [];
for (let i = 0, v = 1; i < 31; i++) {
	exp[i] = v;
	log[v] = i;
	v <<= 1;
	if (v & 32) v ^= 0b100101;
}
check("x generates GF(32)*", String(new Set(exp).size), "31");
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : exp[(log[a] + log[b]) % 31]);
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const alphaPow = (i) => exp[i % 31];
function recoveryText(keyHex) {
	const n = (BigInt(`0x${keyHex}`) << 4n) | 1n; // 256 data bits, then version 1
	const data = [];
	for (let k = 0; k < 52; k++)
		data.push(Number((n >> BigInt(5 * (51 - k))) & 31n));
	let c1 = 0;
	let c2 = 0;
	data.forEach((d, i) => {
		c1 ^= d;
		c2 ^= gfMul(alphaPow(i), d);
	});
	const symbols = [...data, c1, c2].map((s) => ALPHABET[s]).join("");
	return symbols.match(/.{6}/g).join("-");
}

// Vectors.
const seq = (n, start = 0) =>
	hex(Uint8Array.from({ length: n }, (_, i) => (start + i) & 255));

const salt = seq(16, 0x10);
const masters = [
	{
		name: "default parameters, ASCII",
		password: "correct horse battery staple",
		salt,
		memoryKiB: 65536,
		passes: 3,
	},
	{
		name: "floor parameters, fullwidth and decomposed letters, emoji",
		password: "Ｐａss wörd 😀",
		salt: seq(16, 0xa0),
		memoryKiB: 47104,
		passes: 1,
	},
	{
		name: "3-byte UTF-8 and a space",
		password: "咸辣 é€",
		salt: seq(16, 0x40),
		memoryKiB: 49152,
		passes: 2,
	},
].map((v) => {
	const utf8 = Buffer.from(v.password.normalize("NFKC"), "utf8");
	const masterKey = argon(utf8, unhex(v.salt), v.memoryKiB, v.passes);
	return {
		...v,
		normalizedUtf8: hex(utf8),
		masterKey,
		authKey: kdf(masterKey, 1, "rs.mk.v1"),
		wrapKey: kdf(masterKey, 2, "rs.mk.v1"),
	};
});

const rkHexes = [
	"00".repeat(32),
	"ff".repeat(32),
	seq(32),
	seq(32, 0xe0),
	"0123456789abcdeffedcba9876543210a5a5a5a5c3c3c3c3000000010000000f",
];
const recoveryKeys = rkHexes.map((k, i) => ({
	name: ["all zero", "all ones", "ascending", "wrapping", "mixed"][i],
	recoveryKey: k,
	text: recoveryText(k),
	wrapKey: kdf(k, 1, "rs.rk.v1"),
}));

const wrapAad = (alg, role, id) => `rs.wrap.v1|01${alg}|${role}|${id}`;
const wrapKeyHex = seq(32, 0x80);
const akHex = seq(32, 0x20);
const symmetricWraps = [
	["ak-password", "0b1f2e3d-4c5b-4a69-8877-665544332211", akHex],
	["ak-recovery", "0b1f2e3d-4c5b-4a69-8877-665544332211", akHex],
	["collection-key", "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf", seq(32, 0x60)],
	["private-key", "user_1", seq(32, 0xc0)],
].map(([role, id, key], i) => {
	const nonce = seq(24, 0x40 + i);
	const aad = wrapAad("01", role, id);
	const wrapped = Buffer.concat([
		Buffer.from([1, 1]),
		unhex(nonce),
		xchacha(
			unhex(wrapKeyHex),
			unhex(nonce),
			unhex(key),
			Buffer.from(aad, "latin1"),
		),
	]);
	return {
		name: role,
		wrappingKey: wrapKeyHex,
		nonce,
		role,
		id,
		key,
		aad,
		wrapped: hex(wrapped),
	};
});

const boxWraps = [
	[
		"ak-device",
		"device-1",
		akHex,
		"101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f",
	],
	["ak-contact", "contact_7", seq(32, 0x90), seq(32, 0x70)],
].map(([role, id, key, recipientSeed], i) => {
	const { sk, pk } = seedPair(unhex(recipientSeed));
	const aad = wrapAad("02", role, id);
	const binding = blake2b(ascii(aad), 16);
	const plaintext = Buffer.concat([unhex(key), unhex(binding)]);
	const sealed = sealedBox(plaintext, pk, unhex(seq(32, 0xd0 + i)));
	return {
		name: role,
		recipientSeed,
		publicKey: hex(pk),
		privateKey: hex(sk),
		role,
		id,
		key,
		aad,
		binding,
		wrapped: hex(Buffer.concat([Buffer.from([1, 2]), sealed])),
	};
});

const fpKeys = [seq(32, 1), seq(32, 0x81), seq(32, 0xf1)];
const fingerprints = [
	[fpKeys[0]],
	[fpKeys[1]],
	[fpKeys[0], fpKeys[2]],
	[fpKeys[2], fpKeys[0]],
].map((keys, i) => {
	const message = Buffer.concat([
		Buffer.from("rs.fp.v1", "latin1"),
		...keys.map(unhex),
	]);
	const digest = blake2b(hex(message), 16);
	return {
		name: [
			"one key",
			"another key",
			"two keys",
			"the same two keys, other order",
		][i],
		publicKeys: keys,
		phrase: proquint(unhex(digest).subarray(0, 12)).join(" "),
	};
});

const about =
	"Known answers for the key hierarchy (@retrospend/crypto src/keys.ts), spike section 4.4. Regenerate with packages/crypto/scripts/gen-keys.mjs, which uses no libsodium and none of keys.ts.";
const source =
	"packages/crypto/scripts/gen-keys.mjs: node:crypto Argon2id, X25519 and ChaCha20-Poly1305; python3 hashlib.blake2b; hand HChaCha20, Salsa20 and Poly1305; own GF(32) check symbols and proquint. Self-checked against RFC 9106, RFC 7693, the proquint reference examples and the F1 vectors.";
writeFileSync(
	new URL("../vectors/keys.vectors.json", import.meta.url),
	`${JSON.stringify({ about, source, masters, recoveryKeys, symmetricWraps, boxWraps, fingerprints, proquint: published }, null, "\t")}\n`,
);
console.log("wrote key vectors");
