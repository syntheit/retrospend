import { describe, expect, it } from "vitest";
import { Keyring, sealField } from "../crypto/field-crypto";
import {
	foldUnaccentIlike,
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
