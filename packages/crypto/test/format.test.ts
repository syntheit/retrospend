// The sealed record format on the web/Node build. The golden vectors in
// vectors/format.vectors.json are shared with the phone
// (apps/mobile/test/crypto-vectors.test.ts) through runKnownAnswerTests.
import { beforeAll, describe, expect, it } from "vitest";
import {
	CryptoError,
	canonicalJson,
	decodeSealed,
	encodeSealed,
	fromBase64Url,
	fromHex,
	HEADER_BYTES,
	KEY_ID_BYTES,
	NONCE_BYTES,
	openRecord,
	type Primitives,
	type RecordContext,
	type RecordKey,
	readHeader,
	recordAad,
	runKnownAnswerTests,
	sealRecord,
	toBase64Url,
	toHex,
} from "../src";
import { sealRecordWithNonce } from "../src/format";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/format.vectors.json";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const keyId = Uint8Array.from({ length: KEY_ID_BYTES }, (_, i) => 0xa0 + i);
const recordKey: RecordKey = { keyId, key };
const find = (id: Uint8Array) => (toHex(id) === toHex(keyId) ? key : undefined);
const ctx: RecordContext = {
	userId: "user_1",
	collectionId: "coll-1",
	entity: 1,
	recordId: "rec_1",
	version: 3,
};
const record = { title: "Café", amount: { minor: 450, currency: "ARS" } };
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return e instanceof CryptoError ? e.code : "other";
	}
	return "none";
};
const sealed = () => sealRecord(p, recordKey, ctx, 2, record);
const open = (bytes: Uint8Array, c = ctx, k = find) =>
	openRecord(p, k, c, bytes);
const flip = (bytes: Uint8Array, at: number) => {
	const copy = bytes.slice();
	copy[at] = (copy[at] ?? 0) ^ 1;
	return copy;
};

describe("golden vectors", () => {
	it("the shared self-test passes, format vectors included", () => {
		expect(runKnownAnswerTests(p)).toEqual([]);
	});

	it("the self-test reports a build whose AEAD disagrees", () => {
		const broken: Primitives = {
			...p,
			aeadEncrypt: (k, n, m, a) => {
				const out = p.aeadEncrypt(k, n, m, a);
				out[0] = (out[0] ?? 0) ^ 1;
				return out;
			},
		};
		const failed = runKnownAnswerTests(broken);
		expect(failed.some((n) => n.startsWith("format seal:"))).toBe(true);
	});

	it("pins the byte layout, not only the whole record", () => {
		const v = vectors.records[0];
		if (!v) throw new Error("no vector");
		const bytes = fromHex(v.sealed);
		expect(bytes[0]).toBe(1);
		expect(bytes[1]).toBe(1);
		expect(toHex(bytes.subarray(2, 18))).toBe(v.keyId);
		expect(toHex(bytes.subarray(18, 42))).toBe(v.nonce);
		expect(bytes.length - HEADER_BYTES).toBe(v.paddedPlaintext.length / 2 + 16);
	});
});

describe("seal and open", () => {
	it("round trips, with the schema version", () => {
		const opened = open(sealed());
		expect(opened.schemaVersion).toBe(2);
		expect(opened.record).toEqual(record);
	});

	it("round trips through the base64url wire form", () => {
		const text = encodeSealed(sealed());
		expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(open(decodeSealed(text)).record).toEqual(record);
	});

	it("pads to 64-byte buckets and hides small length changes", () => {
		const a = sealRecord(p, recordKey, ctx, 1, { k: "x" });
		const b = sealRecord(p, recordKey, ctx, 1, { k: "xxxxxxxxxxxxxxxxxxxx" });
		expect(a.length).toBe(b.length);
		expect((a.length - HEADER_BYTES - 16) % 64).toBe(0);
	});

	it("the header names version, algorithm and key", () => {
		const h = readHeader(sealed());
		expect([h.version, h.algorithm, toHex(h.keyId)]).toEqual([
			1,
			1,
			toHex(keyId),
		]);
	});

	it("never reuses a nonce", () => {
		const nonces = new Set<string>();
		for (let i = 0; i < 2000; i++) {
			const bytes = sealed();
			nonces.add(toHex(bytes.subarray(2 + KEY_ID_BYTES, HEADER_BYTES)));
		}
		expect(nonces.size).toBe(2000);
		expect(HEADER_BYTES - 2 - KEY_ID_BYTES).toBe(NONCE_BYTES);
	});

	it("refuses arrays with holes, which would seal but never open", () => {
		const seal = (r: unknown) =>
			code(() => sealRecord(p, recordKey, ctx, 1, r as { [k: string]: never }));
		// biome-ignore lint/suspicious/noSparseArray: the hole is the test
		expect(seal({ a: [1, , 2] })).toBe("invalid_input");
		expect(seal({ a: new Array(2) })).toBe("invalid_input");
		expect(seal({ a: [[1, 2], [3]] })).toBe("none");
	});

	it("binds the header and the place into one AAD string", () => {
		const header = Uint8Array.from([1, 1, ...keyId]);
		expect(recordAad(ctx, header)).toBe(
			`rs.v1|0101${toHex(keyId)}|user_1|coll-1|1|rec_1|3`,
		);
		expect(code(() => recordAad(ctx, header.slice(1)))).toBe("invalid_input");
	});

	it("refuses inputs that cannot be sealed exactly", () => {
		const seal = (r: unknown, c = ctx, v = 1) =>
			code(() => sealRecord(p, recordKey, c, v, r as { [k: string]: never }));
		expect(seal({ n: Number.NaN })).toBe("invalid_input");
		expect(seal({ n: undefined })).toBe("invalid_input");
		expect(seal([1])).toBe("invalid_input");
		expect(seal({}, { ...ctx, userId: "a|b" })).toBe("invalid_input");
		expect(seal({}, { ...ctx, entity: -1 })).toBe("invalid_input");
		expect(seal({}, ctx, 70000)).toBe("invalid_input");
		expect(
			code(() => sealRecord(p, { keyId: keyId.slice(1), key }, ctx, 1, {})),
		).toBe("invalid_input");
	});
});

describe("tampering never returns plaintext", () => {
	let good: Uint8Array;
	beforeAll(() => {
		good = sealed();
	});

	it("wrong key", () => {
		const other = key.slice();
		other[0] = 99;
		expect(code(() => open(good, ctx, () => other))).toBe("decrypt_failed");
	});

	it("unknown key id", () => {
		expect(code(() => open(good, ctx, () => undefined))).toBe("decrypt_failed");
	});

	it("each AAD field", () => {
		for (const wrong of [
			{ ...ctx, userId: "user_2" },
			{ ...ctx, collectionId: "coll-2" },
			{ ...ctx, entity: 2 },
			{ ...ctx, recordId: "rec_2" },
			{ ...ctx, version: 4 },
		]) {
			expect(code(() => open(good, wrong))).toBe("decrypt_failed");
		}
	});

	it("truncated at every length", () => {
		for (let n = 0; n < good.length; n++) {
			const c = code(() => open(good.slice(0, n)));
			expect(["decrypt_failed", "invalid_input"]).toContain(c);
		}
	});

	it("extended", () => {
		const longer = new Uint8Array(good.length + 64);
		longer.set(good);
		expect(code(() => open(longer))).toBe("decrypt_failed");
	});

	it("every single flipped bit position in the key id, nonce and body", () => {
		for (let at = 2; at < good.length; at++) {
			expect(code(() => open(flip(good, at)))).toBe("decrypt_failed");
		}
	});

	it("a rewritten key id fails even when the reader hands out the key", () => {
		const anyKey = () => key;
		for (let at = 2; at < 2 + KEY_ID_BYTES; at++) {
			expect(code(() => open(flip(good, at), ctx, anyKey))).toBe(
				"decrypt_failed",
			);
		}
		expect(open(good, ctx, anyKey).record).toEqual(record);
	});

	it("a changed version or algorithm is refused before any key lookup", () => {
		let lookups = 0;
		const spy = () => {
			lookups++;
			return key;
		};
		expect(code(() => open(flip(good, 0), ctx, spy))).toBe("invalid_input");
		expect(code(() => open(flip(good, 1), ctx, spy))).toBe("invalid_input");
		expect(lookups).toBe(0);
	});

	it("unknown version and unknown algorithm", () => {
		for (const at of [0, 1]) {
			for (const value of [0, 2, 255]) {
				const bytes = good.slice();
				bytes[at] = value;
				expect(code(() => open(bytes))).toBe("invalid_input");
			}
		}
	});

	it("authentic but unreadable content is refused, not half-read", () => {
		// Sealed by hand with valid padding around text that is not a record.
		const make = (body: Uint8Array) => {
			const nonce = p.randomBytes(NONCE_BYTES);
			const padded = new Uint8Array(64);
			padded.set(body);
			padded[body.length] = 0x80;
			const ct = p.aeadEncrypt(
				key,
				nonce,
				padded,
				recordAad(ctx, Uint8Array.from([1, 1, ...keyId])),
			);
			const out = new Uint8Array(HEADER_BYTES + ct.length);
			out.set([1, 1]);
			out.set(keyId, 2);
			out.set(nonce, 18);
			out.set(ct, HEADER_BYTES);
			return out;
		};
		const text = (s: string) =>
			Uint8Array.from([0, 1, ...[...s].map((c) => c.charCodeAt(0))]);
		expect(code(() => open(make(text("[1]"))))).toBe("decrypt_failed");
		expect(code(() => open(make(text("{bad"))))).toBe("decrypt_failed");
		expect(code(() => open(make(Uint8Array.from([0, 1, 0xc3, 0xa9]))))).toBe(
			"decrypt_failed",
		);
		expect(open(make(text("{}"))).record).toEqual({});
	});
});

describe("canonical JSON", () => {
	it("sorts keys, drops spaces and escapes everything non-ASCII", () => {
		expect(canonicalJson({ b: 1, a: ["é", "😀", "\u007f"] })).toBe(
			'{"a":["\\u00e9","\\ud83d\\ude00","\\u007f"],"b":1}',
		);
	});

	it("is the same text however the keys were inserted", () => {
		expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
	});

	it("sealing is deterministic for a fixed nonce", () => {
		const nonce = Uint8Array.from({ length: NONCE_BYTES }, (_, i) => i);
		const a = sealRecordWithNonce(p, recordKey, ctx, 1, { a: 1, b: 2 }, nonce);
		const b = sealRecordWithNonce(p, recordKey, ctx, 1, { b: 2, a: 1 }, nonce);
		expect(toHex(a)).toBe(toHex(b));
	});
});

describe("base64url", () => {
	const t = (hex: string) => toBase64Url(fromHex(hex));

	it("matches RFC 4648 section 10 without padding", () => {
		const text = (s: string) =>
			toBase64Url(Uint8Array.from([...s].map((c) => c.charCodeAt(0))));
		expect([
			text(""),
			text("f"),
			text("fo"),
			text("foo"),
			text("foob"),
			text("fooba"),
			text("foobar"),
		]).toEqual(["", "Zg", "Zm8", "Zm9v", "Zm9vYg", "Zm9vYmE", "Zm9vYmFy"]);
	});

	it("uses - and _, never + or /", () => {
		expect(t("fbff")).toBe("-_8");
	});

	it("decodes what it encodes, for every length up to 40", () => {
		for (let n = 0; n <= 40; n++) {
			const bytes = p.randomBytes(n || 1).subarray(0, n);
			expect(
				toHex(fromBase64Url(toBase64Url(bytes)) ?? new Uint8Array([7])),
			).toBe(toHex(bytes));
		}
	});

	it("rejects padding, other alphabets, whitespace and impossible lengths", () => {
		for (const bad of [
			"Zg==",
			"Zg=",
			"Zm9v+",
			"Zm/v",
			"Zm 9v",
			"Zm9v\n",
			"Z",
			"Zm9vY",
			"éé",
		]) {
			expect(fromBase64Url(bad)).toBeNull();
		}
	});

	it("rejects non-canonical trailing bits, so one record has one text", () => {
		expect(fromBase64Url("Zg")).not.toBeNull();
		expect(fromBase64Url("Zh")).toBeNull();
		expect(fromBase64Url("Zm8")).not.toBeNull();
		expect(fromBase64Url("Zm9")).toBeNull();
	});

	it("decodeSealed reports bad text as decrypt_failed", () => {
		expect(code(() => decodeSealed("not base64!"))).toBe("decrypt_failed");
	});
});
