import { describe, expect, it } from "vitest";
import { categoryNameSchema, createCategorySchema } from "../categories";
import {
	hasForbiddenControl,
	hasLoneSurrogate,
	USER_TEXT_FIELDS,
	userText,
} from "./user-text";

const schema = userText("test.field", 20);

describe("userText control characters", () => {
	it("rejects every C0 control except tab, line feed and carriage return", () => {
		for (let code = 0; code < 0x20; code++) {
			const allowed = code === 0x09 || code === 0x0a || code === 0x0d;
			const result = schema.safeParse(`a${String.fromCharCode(code)}b`);
			expect(result.success, `U+${code.toString(16).padStart(4, "0")}`).toBe(
				allowed,
			);
		}
	});

	it("rejects text that starts like a server-encrypted value", () => {
		expect(schema.safeParse("\u0001k1AAAA").success).toBe(false);
	});

	it("accepts emoji, combining marks, right-to-left text and other scripts", () => {
		for (const text of [
			"\u{1F600}",
			"\u{1F468}‍\u{1F469}‍\u{1F467}",
			"é",
			"שלום",
			"مرحبا",
			"‮abc‬",
			"日本語",
			"Café ñ",
			"a\u007Fb",
			"a\u0085b",
		]) {
			expect(schema.safeParse(text).success, JSON.stringify(text)).toBe(true);
		}
	});

	it("rejects lone surrogates and accepts a valid pair", () => {
		for (const text of ["a\uD800", "\uDC00b", "\uD83Dx", "x\uDE00\uD83D"])
			expect(schema.safeParse(text).success, JSON.stringify(text)).toBe(false);
		expect(schema.safeParse("\u{1F600}").success).toBe(true);
		expect(hasLoneSurrogate("\uD83D\uDE00")).toBe(false);
		expect(hasLoneSurrogate("\uD83D")).toBe(true);
	});

	it("keeps the length rules and does not trim", () => {
		expect(schema.safeParse("").success).toBe(false);
		expect(schema.safeParse("x".repeat(21)).success).toBe(false);
		expect(schema.parse("  padded  ")).toBe("  padded  ");
	});

	it("registers the field", () => {
		expect(USER_TEXT_FIELDS.has("test.field")).toBe(true);
	});

	it("hasForbiddenControl reports the same", () => {
		expect(hasForbiddenControl("plain\nmultiline\ttext\r")).toBe(false);
		expect(hasForbiddenControl("bell\u0007")).toBe(true);
	});
});

describe("Category.name", () => {
	it("is a declared user-text field that refuses controls", () => {
		expect(USER_TEXT_FIELDS.has("category.name")).toBe(true);
		const base = { color: "blue" } as const;
		expect(
			createCategorySchema.safeParse({ ...base, name: "Food \u{1F355}" })
				.success,
		).toBe(true);
		expect(
			createCategorySchema.safeParse({ ...base, name: "Food\u0001" }).success,
		).toBe(false);
	});

	it("refuses a blank name but keeps the typed one", () => {
		for (const blank of [" ", "\t \n"])
			expect(categoryNameSchema.safeParse(blank).success).toBe(false);
		expect(categoryNameSchema.parse(" Food ")).toBe(" Food ");
	});
});
