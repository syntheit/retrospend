/** A TITLE rule's text is opened with the rule's own row id; other rules read as before. */
import { describe, expect, it } from "vitest";
import {
	FieldCryptoError,
	Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import type { IncomeRule as RuleRow } from "~prisma";
import { matchOf } from "./rule-store";

const keyring = new Keyring([{ id: 1, key: Buffer.alloc(32, 4) }]);

const row = (over: Partial<RuleRow>) => ({ id: "r1", ...over }) as RuleRow;
const sealed = (text: string, rowId: string) =>
	sealField(keyring, text, {
		table: "income_rule",
		column: "matchTitle",
		rowId,
	});

describe("matchOf TITLE", () => {
	it("reads plaintext as is, with or without a keyring", () => {
		const r = row({ matchKind: "TITLE", matchTitle: "Café" });
		expect(matchOf(r)).toEqual({ kind: "TITLE", contains: "Café" });
		expect(matchOf(r, keyring)).toEqual({ kind: "TITLE", contains: "Café" });
	});

	it("opens sealed text with the keyring", () => {
		const r = row({ matchKind: "TITLE", matchTitle: sealed("Café", "r1") });
		expect(matchOf(r, keyring)).toEqual({ kind: "TITLE", contains: "Café" });
	});

	it("never reads sealed text without a keyring, or under another row id", () => {
		const r = row({ matchKind: "TITLE", matchTitle: sealed("Café", "r1") });
		expect(() => matchOf(r)).toThrow(FieldCryptoError);
		const moved = row({ ...r, id: "r2" });
		expect(() => matchOf(moved, keyring)).toThrow(FieldCryptoError);
	});

	it("a missing text is empty, which matches every title, as before", () => {
		expect(matchOf(row({ matchKind: "TITLE", matchTitle: null }))).toEqual({
			kind: "TITLE",
			contains: "",
		});
	});

	it("other kinds ignore the keyring", () => {
		expect(
			matchOf(row({ matchKind: "CURRENCY", matchValue: "ARS" }), keyring),
		).toEqual({ kind: "CURRENCY", currency: "ARS" });
	});
});
