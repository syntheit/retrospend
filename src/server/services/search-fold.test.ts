import { describe, expect, it } from "vitest";
import { Keyring, sealField } from "../crypto/field-crypto";
import {
	foldUnaccentIlike,
	ilikeContains,
	ilikeEquals,
	pgLower,
	readUserText,
	unaccent,
} from "./search-fold";

const keyring = new Keyring([{ id: 1, key: Buffer.alloc(32, 7) }]);
const aad = { table: "expense", column: "title", rowId: "row1" };

describe("unaccent", () => {
	it("strips accents and expands ligatures like Postgres unaccent", () => {
		expect(unaccent("Café MUÑOZ")).toBe("Cafe MUNOZ");
		expect(unaccent("Straße Æsir œuvre")).toBe("Strasse AEsir oeuvre");
		expect(unaccent("Łódź Øresund Đà")).toBe("Lodz Oresund Da");
	});

	it("drops a combining accent, leaves ASCII and unmapped letters alone", () => {
		expect(unaccent("Almacén")).toBe("Almacen");
		expect(unaccent("plain 100% _ok")).toBe("plain 100% _ok");
		// Postgres leaves й alone but maps ё to е.
		expect(unaccent("Йогурт Ёлка")).toBe("Йогурт Елка");
	});
});

describe("pgLower", () => {
	it("lowercases per letter with no context", () => {
		expect(pgLower("ΟΔΟΣ")).toBe("οδοσ");
		expect(pgLower("İSTANBUL")).toBe("istanbul");
		expect(pgLower("ẞ")).toBe("ß");
	});

	it("handles characters outside the BMP", () => {
		expect(pgLower("\u{10400}")).toBe("\u{10428}");
	});
});

describe("foldUnaccentIlike", () => {
	it("makes accent and case differences vanish", () => {
		expect(foldUnaccentIlike("CAFÉ")).toBe(foldUnaccentIlike("cafe"));
		expect(foldUnaccentIlike("Œuvre")).toBe("oeuvre");
	});
});

describe("ilikeContains", () => {
	it("is a case-insensitive substring test that does not fold accents", () => {
		const has = ilikeContains("CAFE");
		expect(has("Mi cafe")).toBe(true);
		expect(has("café")).toBe(false);
		expect(ilikeContains("ÑANDÚ")("un ñandú")).toBe(true);
		expect(ilikeContains("istanbul")("İstanbul")).toBe(true);
	});

	it("reads percent, underscore and backslash as ILIKE does", () => {
		expect(ilikeContains("a%c")("xx abbbc yy")).toBe(true);
		expect(ilikeContains("a_c")("xx abc yy")).toBe(true);
		expect(ilikeContains("a_c")("xx ac yy")).toBe(false);
		expect(ilikeContains("a\\%c")("a%c")).toBe(true);
		expect(ilikeContains("a\\%c")("abc")).toBe(false);
		expect(ilikeContains("a\\_")("a_")).toBe(true);
		expect(ilikeContains("a\\_")("ab")).toBe(false);
		// A trailing backslash escapes the closing %: the text must end in one.
		expect(ilikeContains("e\\")("tax e%")).toBe(true);
		expect(ilikeContains("e\\")("e% tax")).toBe(false);
	});

	it("handles characters outside the BMP as one character", () => {
		expect(ilikeContains("a_b")("a\u{1f600}b")).toBe(true);
	});

	it("stays fast when many wildcards cannot match", () => {
		const has = ilikeContains(`${"a%".repeat(40)}b`);
		const started = Date.now();
		expect(has("a".repeat(5000))).toBe(false);
		expect(Date.now() - started).toBeLessThan(500);
	});
});

describe("ilikeEquals", () => {
	it("matches the whole text, in any case, without folding accents", () => {
		expect(ilikeEquals("COFFEE")("coffee")).toBe(true);
		expect(ilikeEquals("coffee")("coffee shop")).toBe(false);
		expect(ilikeEquals("coffee")("a coffee")).toBe(false);
		expect(ilikeEquals("cafe")("café")).toBe(false);
		expect(ilikeEquals("coffee")(" coffee")).toBe(false);
	});

	it("reads percent, underscore and backslash as ILIKE does", () => {
		expect(ilikeEquals("50%")("50 off")).toBe(true);
		expect(ilikeEquals("50_ off")("50% off")).toBe(true);
		expect(ilikeEquals("50\\% off")("50% off")).toBe(true);
		expect(ilikeEquals("50\\% off")("50x off")).toBe(false);
		expect(ilikeEquals("a\\b")("ab")).toBe(true);
		expect(ilikeEquals("a\\b")("a\\b")).toBe(false);
	});

	it("matches nothing for a lone trailing backslash", () => {
		expect(ilikeEquals("a\\")("a\\")).toBe(false);
		expect(ilikeEquals("a\\")("a")).toBe(false);
		// An escaped backslash is one literal backslash.
		expect(ilikeEquals("a\\\\")("a\\")).toBe(true);
	});
});

describe("readUserText", () => {
	it("passes plaintext and null through without a key", () => {
		expect(readUserText(undefined, "Café", aad)).toBe("Café");
		expect(readUserText(undefined, null, aad)).toBe("");
	});

	it("opens ciphertext with the key", () => {
		const sealed = sealField(keyring, "Café con leche", aad);
		expect(readUserText(keyring, sealed, aad)).toBe("Café con leche");
	});

	it("throws on ciphertext with no key, or for another row", () => {
		const sealed = sealField(keyring, "Café", aad);
		expect(() => readUserText(undefined, sealed, aad)).toThrow();
		expect(() =>
			readUserText(keyring, sealed, { ...aad, rowId: "row2" }),
		).toThrow();
	});
});
