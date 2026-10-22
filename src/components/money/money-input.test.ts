import { describe, expect, it } from "vitest";
import {
	caretAfterDraft,
	draftEdit,
	numpadDecimal,
	visibleError,
} from "./money-input";

const en = { locale: "en", currency: "USD", pasted: false };
const ar = { locale: "es-AR", currency: "ARS", pasted: false };

describe("MoneyInput caret", () => {
	it("stays after the digit just typed when a group separator appears", () => {
		// "123|" + "4" -> "1234|" drafted to "1,234|"
		expect(caretAfterDraft("1234", 4, "1,234", ",")).toBe(5);
		// typing in the middle: "1,2|34" + "5" -> "1,25|34" -> "12,534": caret after the 5
		expect(caretAfterDraft("1,2534", 4, "12,534", ",")).toBe(4);
		expect(caretAfterDraft("1234567,5", 9, "1.234.567,5", ".")).toBe(11);
		expect(caretAfterDraft("1234", 0, "1,234", ",")).toBe(0);
	});

	it("stays put when the draft keeps the text as typed", () => {
		expect(caretAfterDraft("12.", 3, "12.", ".")).toBe(3);
		expect(caretAfterDraft("1,", 2, "1,", ",")).toBe(2);
	});
});

describe("MoneyInput edits (real domain parser)", () => {
	it("groups while typing in en and es-AR", () => {
		expect(draftEdit("1234", 4, { ...en, previous: "123" })).toMatchObject({
			text: "1,234",
			caret: 5,
			result: { ok: true, minor: 123400 },
		});
		expect(
			draftEdit("1234567", 7, { ...ar, previous: "123456" }),
		).toMatchObject({
			text: "1.234.567",
			caret: 9,
		});
	});

	it('"12." typed in es-AR stays as typed with the caret after it, and is ambiguous', () => {
		const edit = draftEdit("12.", 3, { ...ar, previous: "12" });
		expect(edit.text).toBe("12.");
		expect(edit.caret).toBe(3);
		expect(edit.result).toEqual({ ok: false, error: "ambiguous" });
	});

	it('"1," typed in en stays as typed with the caret after it', () => {
		const edit = draftEdit("1,", 2, { ...en, previous: "1" });
		expect(edit.text).toBe("1,");
		expect(edit.caret).toBe(2);
		expect(edit.result.ok).toBe(false);
	});

	it("math is evaluated by the domain parser", () => {
		const edit = draftEdit("1500+2000", 9, { ...ar, previous: "1500+200" });
		expect(edit.result).toEqual({ ok: true, minor: 350000, expression: true });
	});

	it("a paste that is ambiguous in this locale is kept exactly as pasted", () => {
		const edit = draftEdit("1,23", 4, { ...en, previous: "", pasted: true });
		expect(edit).toEqual({
			text: "1,23",
			caret: 4,
			result: { ok: false, error: "ambiguous" },
		});
	});
});

describe("MoneyInput numpad decimal", () => {
	const numpad = { code: "NumpadDecimal", key: "." };
	it("types the locale decimal where . is a group separator", () => {
		expect(numpadDecimal(numpad, "12", 2, 2, ",")).toEqual({
			text: "12,",
			caret: 3,
		});
		// over a selection: "1[23]4" -> "1,4"
		expect(numpadDecimal(numpad, "1234", 1, 3, ",")).toEqual({
			text: "1,4",
			caret: 2,
		});
	});

	it("then drafts as a decimal: 12,5 in es-AR", () => {
		const typed = numpadDecimal(numpad, "12", 2, 2, ",");
		const edit = draftEdit(typed?.text ?? "", typed?.caret ?? 0, {
			...ar,
			previous: "12",
		});
		expect(edit.text).toBe("12,");
	});

	it("leaves the key alone where it already types the decimal", () => {
		expect(numpadDecimal(numpad, "12", 2, 2, ".")).toBeNull();
		expect(
			numpadDecimal({ code: "NumpadDecimal", key: "," }, "12", 2, 2, ","),
		).toBeNull();
	});

	it("a . from the main keyboard stays as typed (the parser calls it ambiguous)", () => {
		expect(
			numpadDecimal({ code: "Period", key: "." }, "12", 2, 2, ","),
		).toBeNull();
	});
});

describe("MoneyInput errors", () => {
	const bad = { ok: false as const, error: "incomplete" as const };
	it("wait for blur or a Save attempt", () => {
		expect(visibleError(bad, false)).toBeNull();
		expect(visibleError(bad, true)).toBe("incomplete");
	});

	it("an empty field is not an error by itself; a valid one never is", () => {
		expect(visibleError({ ok: false, error: "empty" }, true)).toBeNull();
		expect(
			visibleError({ ok: true, minor: 350000, expression: true }, true),
		).toBeNull();
	});
});
