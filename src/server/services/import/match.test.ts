/**
 * An imported title is keyed on the file's own text. A control character in it
 * is a separator, so a row stored with the control still in it (before text
 * was cleaned) and the same row read from the file again get one key.
 */
import { describe, expect, it } from "vitest";
import { fileFingerprint, matchRowOf, normalizeTitle } from "./match";
import { prepareRows } from "./prepare";

const stored = (title: string) => ({
	title,
	amount: 3500,
	currency: "ARS",
	date: "2026-10-05",
	location: "",
	description: "",
	pricingSource: "IMPORT",
	category: "",
});

const prepared = (title: string) => {
	const row = prepareRows([stored(title)], { timeZone: "UTC" }).rows[0];
	if (!row) throw new Error("no row");
	return row;
};

describe("normalizeTitle", () => {
	it("reads a control character as a separator", () => {
		expect(normalizeTitle("COFFEE\u000bSHOP 123")).toBe("coffee shop 123");
		expect(normalizeTitle("COFFEE\u0001\u0007SHOP")).toBe("coffee shop");
		expect(normalizeTitle("COFFEE\tSHOP")).toBe("coffee shop");
	});

	it("is the cleaned text that loses the separator, so keys must start from the file's text", () => {
		expect(normalizeTitle("COFFEESHOP 123")).toBe("coffeeshop 123");
	});
});

describe("import keys", () => {
	it("the fingerprint comes from the file's text, not the cleaned title", () => {
		const row = prepared("COFFEE\u000bSHOP 123");
		expect(row.title).toBe("COFFEESHOP 123");
		expect(fileFingerprint(row)).toBe(
			fileFingerprint(prepared("COFFEE SHOP 123")),
		);
		expect(fileFingerprint(row)).not.toBe(
			fileFingerprint(prepared("COFFEESHOP 123")),
		);
	});

	it("the same-row key uses the file's text too", () => {
		const row = prepared("COFFEE\u000bSHOP 123");
		expect(normalizeTitle(matchRowOf(row, "expense").title)).toBe(
			"coffee shop 123",
		);
	});
});
