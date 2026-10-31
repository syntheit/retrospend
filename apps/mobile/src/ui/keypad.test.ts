import {
	type NumberFormatChoice,
	withNumberFormat,
} from "@retrospend/domain/format-locale";
import { parseMoneyInput } from "@retrospend/domain/parse";
import parseVectors from "@retrospend/domain/vectors/money-parse.vectors.json";
import {
	applyEntryKey,
	applyKey,
	applyPlainKey,
	BACKSPACE,
	keypadLayout,
	TRIPLE_ZERO,
} from "./keypad";

// The keypad must produce exactly the drafts the domain vectors promise.
describe("keypad against the golden keystroke vectors", () => {
	it.each(parseVectors.keystrokes)("$name", (c) => {
		const locale = withNumberFormat(
			c.locale,
			(c as { numberFormat?: NumberFormatChoice }).numberFormat,
		);
		let draft = "";
		const drafts = c.keys.map((key: string) => {
			draft = applyKey(draft, key, locale, c.currency);
			return draft;
		});
		expect(drafts).toEqual(c.drafts);
		const result = parseMoneyInput(draft, locale, c.currency);
		if ("minor" in c.expected) {
			expect(result).toMatchObject({ ok: true, minor: c.expected.minor });
		}
	});
});

describe("keypadLayout", () => {
	it("uses the locale's decimal separator", () => {
		expect(keypadLayout("en-US")[3]?.[0]).toBe(".");
		expect(keypadLayout("es-AR")[3]?.[0]).toBe(",");
	});

	it("is the twelve keys of the number pad, ending in backspace", () => {
		const keys = keypadLayout("en-US").flat();
		expect(keys).toHaveLength(12);
		expect(keys.at(-1)).toBe(BACKSPACE);
		expect(keys).not.toContain(TRIPLE_ZERO);
	});

	it("still takes three zeros as one key", () => {
		let draft = "";
		for (const key of ["1", "2", "5", TRIPLE_ZERO]) {
			draft = applyKey(draft, key, "en-US", "ARS");
		}
		expect(parseMoneyInput(draft, "en-US", "ARS")).toMatchObject({
			ok: true,
			minor: 12_500_000,
		});
	});
});

describe("keys for a part that is not money", () => {
	const type = (keys: string[], kind: "percent" | "units") =>
		keys.reduce((text, key) => applyPlainKey(text, key, kind, "en-US"), "");

	it("types a percent up to 100 with two decimals", () => {
		expect(type(["1", "2", ".", "5"], "percent")).toBe("12.5");
		expect(type(["1", "2", ".", "5", "5", "5"], "percent")).toBe("12.55");
		expect(type(["1", "0", "0", "0"], "percent")).toBe("100");
		expect(type([".", "5"], "percent")).toBe("0.5");
		expect(type(["1", ".", ".", "2"], "percent")).toBe("1.2");
	});

	it("types shares as whole numbers and ignores the decimal key", () => {
		expect(type(["2", ".", "5"], "units")).toBe("25");
		expect(type(["0", "3"], "units")).toBe("3");
		expect(type(["1", "2", "3", "4", "5", "6", "7"], "units")).toBe("123456");
	});

	it("deletes the last character", () => {
		expect(applyPlainKey("12.5", BACKSPACE, "percent", "en-US")).toBe("12.");
	});

	it("sends money to the money keypad", () => {
		expect(applyEntryKey("12", "5", "money", "en-US", "USD")).toBe(
			applyKey("12", "5", "en-US", "USD"),
		);
		expect(applyEntryKey("12", "5", "units", "en-US", "USD")).toBe("125");
	});
});
