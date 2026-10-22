import { describe, expect, it } from "vitest";
import { caretAfterRegroup, numpadDecimal, visibleError } from "./money-input";

describe("MoneyInput caret", () => {
	it("stays after the digit just typed when a group separator appears", () => {
		// "123|" + "4" -> "1234|" regrouped to "1,234|"
		expect(caretAfterRegroup("1234", 4, "1,234", ",")).toBe(5);
		// typing in the middle: "1,2|34" + "5" -> "1,25|34" -> "12,534": caret after the 5
		expect(caretAfterRegroup("1,2534", 4, "12,534", ",")).toBe(4);
	});

	it("works with es-AR dots and a decimal part", () => {
		expect(caretAfterRegroup("1234567,5", 9, "1.234.567,5", ".")).toBe(11);
		expect(caretAfterRegroup("1234567,5", 3, "1.234.567,5", ".")).toBe(4);
	});

	it("keeps the caret at the start", () => {
		expect(caretAfterRegroup("1234", 0, "1,234", ",")).toBe(0);
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
