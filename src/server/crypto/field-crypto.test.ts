import { inspect } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import vectors from "./field-crypto.vectors.json";

// A fixed nonce for the known-answer tests only; otherwise the real one.
const fixedNonce = vi.hoisted(() => ({
	value: undefined as Buffer | undefined,
}));
vi.mock("node:crypto", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:crypto")>();
	return {
		...real,
		randomBytes: (size: number) =>
			fixedNonce.value && size === 12
				? fixedNonce.value
				: real.randomBytes(size),
	};
});

import {
	buildAad,
	FieldCryptoError,
	type FieldCryptoErrorCode,
	isSealedField,
	Keyring,
	openField,
	readField,
	sealField,
} from "./field-crypto";

const KEY_1 = Buffer.alloc(32, 0x42);
const KEY_2 = Buffer.alloc(32, 0x99);
const CELL = { table: "Category", column: "name", rowId: "row-1" };

function ring(...ids: Array<[number, Buffer]>) {
	return new Keyring(ids.map(([id, key]) => ({ id, key })));
}

function codeOf(run: () => unknown): FieldCryptoErrorCode {
	try {
		run();
	} catch (error) {
		if (error instanceof FieldCryptoError) return error.code;
		throw error;
	}
	throw new Error("did not throw");
}

/** Flip one bit in the binary part of a wire value. */
function flip(wire: string, byteIndex: number): string {
	const raw = Buffer.from(wire.slice(4), "base64");
	raw[byteIndex] = (raw[byteIndex] ?? 0) ^ 0x01;
	return wire.slice(0, 4) + raw.toString("base64");
}

beforeEach(() => {
	fixedNonce.value = undefined;
});

describe("known answers (computed by scripts/crypto-vectors.py)", () => {
	for (const v of vectors) {
		const keyring = ring([v.keyId, Buffer.from(v.keyHex, "hex")]);
		const cell = { table: v.table, column: v.column, rowId: v.rowId };

		it(`${v.name}: sealing with the vector's nonce gives the vector`, () => {
			fixedNonce.value = Buffer.from(v.nonceHex, "hex");
			expect(sealField(keyring, v.plaintext, cell)).toBe(v.wire);
		});

		it(`${v.name}: opening the vector gives the plaintext`, () => {
			expect(openField(keyring, v.wire, cell)).toBe(v.plaintext);
		});
	}
});

describe("round trip", () => {
	const keyring = ring([1, KEY_1]);
	const samples = [
		"Groceries",
		"",
		"\u{1F600} party",
		"é (e + combining acute)",
		"שלום مرحبا",
		"line one\nline two\ttabbed",
		"x".repeat(5000),
	];
	for (const text of samples) {
		it(`restores ${JSON.stringify(text.slice(0, 20))}`, () => {
			const sealed = sealField(keyring, text, CELL);
			expect(isSealedField(sealed)).toBe(true);
			expect(sealed.startsWith("\u0001k1:")).toBe(true);
			expect(openField(keyring, sealed, CELL)).toBe(text);
		});
	}

	it("uses a fresh 12-byte nonce every time", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const raw = Buffer.from(
				sealField(keyring, "same", CELL).slice(4),
				"base64",
			);
			seen.add(raw.subarray(4, 16).toString("hex"));
		}
		expect(seen.size).toBe(200);
	});

	it("refuses text that is not valid UTF-8 rather than corrupting it", () => {
		expect(codeOf(() => sealField(keyring, "a\uD800b", CELL))).toBe(
			"bad_plaintext",
		);
		expect(codeOf(() => sealField(keyring, "a\uDC00", CELL))).toBe(
			"bad_plaintext",
		);
		expect(codeOf(() => sealField(keyring, "\uD83D", CELL))).toBe(
			"bad_plaintext",
		);
	});
});

describe("keys and rotation", () => {
	it("seals with the first key and still opens values from older ones", () => {
		const oldRing = ring([1, KEY_1]);
		const newRing = ring([2, KEY_2], [1, KEY_1]);
		const oldValue = sealField(oldRing, "old", CELL);
		const newValue = sealField(newRing, "new", CELL);
		expect(Buffer.from(newValue.slice(4), "base64").readUInt32BE(0)).toBe(2);
		expect(openField(newRing, oldValue, CELL)).toBe("old");
		expect(openField(newRing, newValue, CELL)).toBe("new");
	});

	it("a value naming a key id the ring lacks is unknown_key", () => {
		const value = sealField(ring([2, KEY_2]), "x", CELL);
		expect(codeOf(() => openField(ring([1, KEY_1]), value, CELL))).toBe(
			"unknown_key",
		);
	});

	it("the same id with different key bytes fails the tag", () => {
		const value = sealField(ring([1, KEY_1]), "x", CELL);
		expect(codeOf(() => openField(ring([1, KEY_2]), value, CELL))).toBe(
			"auth_failed",
		);
	});

	it("relabeling the key id in the header fails the tag", () => {
		const both = ring([1, KEY_1], [2, KEY_1]);
		const value = sealField(both, "x", CELL);
		const raw = Buffer.from(value.slice(4), "base64");
		raw.writeUInt32BE(2, 0);
		const relabeled = value.slice(0, 4) + raw.toString("base64");
		expect(codeOf(() => openField(both, relabeled, CELL))).toBe("auth_failed");
	});

	it("refuses unusable key sets", () => {
		const bad: Array<Array<{ id: number; key: Buffer }>> = [
			[],
			[{ id: 1, key: Buffer.alloc(31, 1) }],
			[{ id: 1, key: Buffer.alloc(33, 1) }],
			[{ id: 1, key: Buffer.alloc(32, 0) }],
			[{ id: 0, key: KEY_1 }],
			[{ id: 4294967296, key: KEY_1 }],
			[{ id: 1.5, key: KEY_1 }],
			[
				{ id: 1, key: KEY_1 },
				{ id: 1, key: KEY_2 },
			],
		];
		for (const entries of bad) {
			expect(codeOf(() => new Keyring(entries))).toBe("bad_key");
		}
	});

	it("shows no key bytes when logged or serialized", () => {
		const keyring = ring([1, KEY_1]);
		const hex = KEY_1.toString("hex");
		const b64 = KEY_1.toString("base64");
		for (const text of [
			JSON.stringify(keyring),
			inspect(keyring, { depth: 5, showHidden: true }),
			String(keyring),
		]) {
			expect(text).not.toContain(hex);
			expect(text).not.toContain(b64);
		}
	});
});

describe("binding to the cell", () => {
	const keyring = ring([1, KEY_1]);
	const sealed = sealField(keyring, "secret", CELL);

	for (const [label, other] of [
		["table", { ...CELL, table: "Expense" }],
		["column", { ...CELL, column: "color" }],
		["row id", { ...CELL, rowId: "row-2" }],
	] as const) {
		it(`a different ${label} fails`, () => {
			expect(codeOf(() => openField(keyring, sealed, other))).toBe(
				"auth_failed",
			);
		});
	}

	it("keeps parts apart where concatenation would not", () => {
		const a = buildAad(1, { table: "ab", column: "c", rowId: "d" });
		const b = buildAad(1, { table: "a", column: "bc", rowId: "d" });
		expect(a.equals(b)).toBe(false);
	});

	it("refuses an empty part", () => {
		expect(codeOf(() => sealField(keyring, "x", { ...CELL, rowId: "" }))).toBe(
			"bad_aad",
		);
	});
});

describe("damaged values", () => {
	const keyring = ring([1, KEY_1]);
	const sealed = sealField(keyring, "secret text", CELL);
	const length = Buffer.from(sealed.slice(4), "base64").length;

	it("a flipped bit in the tag fails", () => {
		expect(
			codeOf(() => openField(keyring, flip(sealed, length - 1), CELL)),
		).toBe("auth_failed");
	});

	it("a flipped bit in the ciphertext fails", () => {
		expect(codeOf(() => openField(keyring, flip(sealed, 16), CELL))).toBe(
			"auth_failed",
		);
	});

	it("a flipped bit in the nonce fails", () => {
		expect(codeOf(() => openField(keyring, flip(sealed, 5), CELL))).toBe(
			"auth_failed",
		);
	});

	it("truncated values are malformed or fail, never decrypt", () => {
		for (const cut of [0, 1, 5, 20, 31]) {
			const raw = Buffer.from(sealed.slice(4), "base64").subarray(0, cut);
			const short = sealed.slice(0, 4) + raw.toString("base64");
			expect(codeOf(() => openField(keyring, short, CELL))).toBe("malformed");
		}
		// Long enough to parse; one byte short of the tag.
		const raw = Buffer.from(sealed.slice(4), "base64");
		const chopped =
			sealed.slice(0, 4) + raw.subarray(0, length - 1).toString("base64");
		expect(codeOf(() => openField(keyring, chopped, CELL))).toBe("auth_failed");
	});

	it("appended bytes fail", () => {
		const raw = Buffer.concat([
			Buffer.from(sealed.slice(4), "base64"),
			Buffer.from([0]),
		]);
		expect(
			codeOf(() =>
				openField(keyring, sealed.slice(0, 4) + raw.toString("base64"), CELL),
			),
		).toBe("auth_failed");
	});

	it("an unknown format version is its own error, not plaintext", () => {
		const future = `\u0001k2:${sealed.slice(4)}`;
		expect(codeOf(() => openField(keyring, future, CELL))).toBe(
			"unsupported_version",
		);
		expect(isSealedField(future)).toBe(true);
		expect(codeOf(() => readField(keyring, future, CELL))).toBe(
			"unsupported_version",
		);
	});

	it("the colon keeps k1: apart from k10: to k19: and from base64 digits", () => {
		for (const version of ["k10", "k12", "k19", "k100"]) {
			expect(
				codeOf(() =>
					openField(keyring, `\u0001${version}:${sealed.slice(4)}`, CELL),
				),
			).toBe("unsupported_version");
		}
		// No colon is not a version at all.
		expect(
			codeOf(() => openField(keyring, `\u0001k12${sealed.slice(4)}`, CELL)),
		).toBe("malformed");
	});

	it("rejects bad base64 and plaintext handed to openField", () => {
		expect(
			codeOf(() => openField(keyring, `\u0001k1:${"!".repeat(60)}`, CELL)),
		).toBe("malformed");
		expect(
			codeOf(() => openField(keyring, `\u0001k1:${sealed.slice(4)}\n`, CELL)),
		).toBe("malformed");
		expect(codeOf(() => openField(keyring, "Groceries", CELL))).toBe(
			"malformed",
		);
		expect(codeOf(() => openField(keyring, "\u0001zzz", CELL))).toBe(
			"malformed",
		);
	});

	it("errors name no key, id, plaintext or ciphertext", () => {
		const attempts = [
			() => openField(keyring, flip(sealed, length - 1), CELL),
			() => openField(ring([2, KEY_2]), sealed, CELL),
			() => openField(keyring, `\u0001k2:${sealed.slice(4)}`, CELL),
			() => sealField(keyring, "a\uD800", CELL),
		];
		for (const attempt of attempts) {
			try {
				attempt();
				throw new Error("did not throw");
			} catch (error) {
				const text = `${(error as Error).message} ${(error as Error).stack ?? ""} ${inspect(error)}`;
				expect(text).not.toContain(KEY_1.toString("hex"));
				expect(text).not.toContain(sealed.slice(4, 21));
				expect(text).not.toContain("secret text");
				expect((error as Error).cause).toBeUndefined();
			}
		}
	});
});

describe("mixed plaintext and ciphertext", () => {
	const keyring = ring([1, KEY_1]);

	it("reads plaintext as is and ciphertext decrypted", () => {
		const sealed = sealField(keyring, "Rent", CELL);
		expect(readField(keyring, "Rent", CELL)).toBe("Rent");
		expect(readField(keyring, sealed, CELL)).toBe("Rent");
	});

	it("tells the two apart by the U+0001 start, which userText forbids", () => {
		expect(isSealedField("Rent")).toBe(false);
		expect(isSealedField("")).toBe(false);
		expect(isSealedField(sealField(keyring, "Rent", CELL))).toBe(true);
	});
});
