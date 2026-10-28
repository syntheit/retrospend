// Runs the golden money vectors. The JSON files are the contract: mobile jest
// and third-party clients run the same files against their own formatter.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FormatMoneyOptions,
	formatMoney,
	formatMoneyPair,
} from "../src/format";
import {
	clearLocaleCaches,
	type NumberFormatChoice,
	withMoneyContext,
} from "../src/format-locale";
import { setPartsMode } from "../src/intl-parts";
import type { Money } from "../src/money-minor";
import {
	decimalSeparator,
	draftFromMinor,
	formatMoneyDraft,
	groupSeparator,
	parseMoneyInput,
} from "../src/parse";
import formatVectors from "./money-format.vectors.json";
import parseVectors from "./money-parse.vectors.json";

type Options = Omit<FormatMoneyOptions, "locale">;
/** A case's locale with its numberFormat and homeCurrency settings on it, as every client sets it. */
const loc = (c: {
	locale: string;
	numberFormat?: NumberFormatChoice;
	homeCurrency?: string;
}) => withMoneyContext(c.locale, c);


interface FormatCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	homeCurrency?: string;
	money?: Money | null;
	options?: Options;
	expected?: string | null;
	throws?: string;
}

interface PairCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	homeCurrency?: string;
	original: Money;
	home: Money | null;
	options?: Options;
	expected: { original: string; home: string | null };
}

interface ParseCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	homeCurrency?: string;
	currency: string;
	text: string;
	expected: { minor: number } | { error: string };
}

interface DraftCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	homeCurrency?: string;
	currency: string;
	text: string;
	expected: string;
}

const formatCases = formatVectors.format as FormatCase[];
const pairCases = formatVectors.pair as PairCase[];
const parseCases = parseVectors.parse as ParseCase[];
const draftCases = parseVectors.draft as DraftCase[];

interface KeystrokeCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	homeCurrency?: string;
	currency: string;
	keys: string[];
	drafts: string[];
	expected: { minor: number } | { error: string };
}

interface SeparatorCase {
	locale: string;
	numberFormat?: NumberFormatChoice;
	homeCurrency?: string;
	decimal: string;
	group: string;
}

const keystrokeCases = parseVectors.keystrokes as KeystrokeCase[];
const BACKSPACE = "\u232b";

interface DraftFromMinorCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	homeCurrency?: string;
	money: Money;
	expected: string;
}

const fromMinorCases = parseVectors.draftFromMinor as DraftFromMinorCase[];

// Every vector runs twice: with the engine's formatToParts, and with the
// fallback that rebuilds parts from format() (Hermes on iOS has no
// formatToParts). Both must give the same strings.
describe.each(["auto", "fallback"] as const)("parts path: %s", (path) => {
	beforeAll(() => {
		setPartsMode(path);
		clearLocaleCaches();
	});
	afterAll(() => {
		setPartsMode("auto");
		clearLocaleCaches();
	});

	describe("money-format vectors", () => {
		it.each(formatCases)("$name", (c) => {
			const run = () =>
				formatMoney(c.money, { locale: loc(c), ...c.options });
			if (c.throws) {
				expect(run).toThrow(c.throws === "RangeError" ? RangeError : Error);
				return;
			}
			expect(run()).toBe(c.expected);
		});

		it.each(pairCases)("pair: $name", (c) => {
			expect(
				formatMoneyPair(c.original, c.home, { locale: loc(c), ...c.options }),
			).toEqual(c.expected);
		});
	});

	describe("money-parse vectors", () => {
		it.each(parseCases)("$name", (c) => {
			const result = parseMoneyInput(c.text, loc(c), c.currency);
			if ("minor" in c.expected) {
				expect(result).toMatchObject({ ok: true, minor: c.expected.minor });
			} else {
				expect(result).toEqual({ ok: false, error: c.expected.error });
			}
		});

		it.each(draftCases)("draft: $name", (c) => {
			const once = formatMoneyDraft(c.text, loc(c), c.currency);
			expect(once).toBe(c.expected);
			expect(formatMoneyDraft(once, loc(c), c.currency)).toBe(once);
		});

		it.each(keystrokeCases)("keystrokes: $name", (c) => {
			let draft = "";
			const drafts = c.keys.map((key) => {
				const text = key === BACKSPACE ? draft.slice(0, -1) : draft + key;
				draft = formatMoneyDraft(text, loc(c), c.currency, draft);
				return draft;
			});
			expect(drafts).toEqual(c.drafts);
			const result = parseMoneyInput(draft, loc(c), c.currency);
			if ("minor" in c.expected) {
				expect(result).toMatchObject({ ok: true, minor: c.expected.minor });
			} else {
				expect(result).toEqual({ ok: false, error: c.expected.error });
			}
		});

		it.each(fromMinorCases)("draftFromMinor: $name", (c) => {
			const { minor, currency } = c.money;
			const draft = draftFromMinor(minor, loc(c), currency);
			expect(draft).toBe(c.expected);
			expect(parseMoneyInput(draft, loc(c), currency)).toMatchObject({
				ok: true,
				minor,
			});
			expect(formatMoneyDraft(draft, loc(c), currency)).toBe(draft);
		});

		it.each(parseVectors.separators as SeparatorCase[])("separators: $locale $numberFormat", (c) => {
			expect(decimalSeparator(loc(c))).toBe(c.decimal);
			expect(groupSeparator(loc(c))).toBe(c.group);
		});

		it("parses what it formats: every successful parse survives a draft", () => {
			for (const c of parseCases) {
				if (!("minor" in c.expected)) continue;
				const draft = formatMoneyDraft(c.text, loc(c), c.currency);
				expect(
					parseMoneyInput(draft, loc(c), c.currency),
					c.name,
				).toMatchObject({ ok: true, minor: c.expected.minor });
			}
		});
	});
});
