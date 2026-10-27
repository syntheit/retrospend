import {
	type NumberFormatChoice,
	withNumberFormat,
} from "@retrospend/domain/format-locale";
import { parseMoneyInput } from "@retrospend/domain/parse";
import parseVectors from "@retrospend/domain/vectors/money-parse.vectors.json";
import { applyKey, BACKSPACE, keypadLayout, TRIPLE_ZERO } from "./keypad";

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

	it("has backspace and the triple zero key", () => {
		const keys = keypadLayout("en-US").flat();
		expect(keys).toContain(BACKSPACE);
		expect(keys).toContain(TRIPLE_ZERO);
	});

	it("types 125 000 with the triple zero key", () => {
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
