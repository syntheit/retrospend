/**
 * An imported title is keyed on the file's own text. A control character in it
 * is a separator, so a row stored with the control still in it (before text
 * was cleaned) and the same row read from the file again get one key.
 */
import { describe, expect, it } from "vitest";
import {
	type ExistingRow,
	fileFingerprint,
	type MatchRow,
	matchRowOf,
	matchRows,
	normalizeTitle,
} from "./match";
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

describe("matchRows with a cleaned file", () => {
	const file = (title: string): MatchRow => ({
		index: 0,
		day: "2026-10-05",
		currency: "ARS",
		minor: "3500.00",
		kind: "expense",
		title,
		fingerprint: "none",
	});
	const existing = (title: string): ExistingRow => ({
		id: "e1",
		title,
		day: "2026-10-05",
		currency: "ARS",
		minor: "3500.00",
		kind: "expense",
		fingerprint: null,
	});
	const exact = (fileTitle: string, storedTitle: string) =>
		matchRows([file(fileTitle)], [existing(storedTitle)]).get(0)?.exact !==
		null;

	it("a legacy row with the control meets the cleaned row, and the separated one", () => {
		expect(exact("AB", "A\u000bB")).toBe(true);
		expect(exact("A B", "A\u000bB")).toBe(true);
	});

	it("a stored title that starts with U+0001 never throws, and reads as cleaned", () => {
		expect(exact("Coffee", "\u0001Coffee")).toBe(true);
		expect(exact("Tea", "\u0001Coffee")).toBe(false);
	});

	it("rows that only differ by a space stay apart", () => {
		expect(exact("AB", "A B")).toBe(false);
		expect(exact("A B", "AB")).toBe(false);
		expect(exact("AB", "A\u000bC")).toBe(false);
	});
});
