// Runs the golden money vectors. The JSON files are the contract: mobile jest
// and third-party clients run the same files against their own formatter.
import { describe, expect, it } from "vitest";
import {
	type FormatMoneyOptions,
	formatMoney,
	formatMoneyPair,
} from "../src/format";
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

interface FormatCase {
	name: string;
	locale: string;
	money?: Money | null;
	options?: Options;
	expected?: string | null;
	throws?: string;
}

interface PairCase {
	name: string;
	locale: string;
	original: Money;
	home: Money | null;
	options?: Options;
	expected: { original: string; home: string | null };
}

interface ParseCase {
	name: string;
	locale: string;
	currency: string;
	text: string;
	expected: { minor: number } | { error: string };
}

interface DraftCase {
	name: string;
	locale: string;
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
	currency: string;
	keys: string[];
	drafts: string[];
	expected: { minor: number } | { error: string };
}

const keystrokeCases = parseVectors.keystrokes as KeystrokeCase[];
const BACKSPACE = "\u232b";

interface DraftFromMinorCase {
	name: string;
	locale: string;
	money: Money;
	expected: string;
}

const fromMinorCases = parseVectors.draftFromMinor as DraftFromMinorCase[];

describe("money-format vectors", () => {
	it.each(formatCases)("$name", (c) => {
		const run = () => formatMoney(c.money, { locale: c.locale, ...c.options });
		if (c.throws) {
			expect(run).toThrow(c.throws === "RangeError" ? RangeError : Error);
			return;
		}
		expect(run()).toBe(c.expected);
	});

	it.each(pairCases)("pair: $name", (c) => {
		expect(
			formatMoneyPair(c.original, c.home, { locale: c.locale, ...c.options }),
		).toEqual(c.expected);
	});
});

describe("money-parse vectors", () => {
	it.each(parseCases)("$name", (c) => {
		const result = parseMoneyInput(c.text, c.locale, c.currency);
		if ("minor" in c.expected) {
			expect(result).toMatchObject({ ok: true, minor: c.expected.minor });
		} else {
			expect(result).toEqual({ ok: false, error: c.expected.error });
		}
	});

	it.each(draftCases)("draft: $name", (c) => {
		const once = formatMoneyDraft(c.text, c.locale, c.currency);
		expect(once).toBe(c.expected);
		expect(formatMoneyDraft(once, c.locale, c.currency)).toBe(once);
	});

	it.each(keystrokeCases)("keystrokes: $name", (c) => {
		let draft = "";
		const drafts = c.keys.map((key) => {
			const text = key === BACKSPACE ? draft.slice(0, -1) : draft + key;
			draft = formatMoneyDraft(text, c.locale, c.currency, draft);
			return draft;
		});
		expect(drafts).toEqual(c.drafts);
		const result = parseMoneyInput(draft, c.locale, c.currency);
		if ("minor" in c.expected) {
			expect(result).toMatchObject({ ok: true, minor: c.expected.minor });
		} else {
			expect(result).toEqual({ ok: false, error: c.expected.error });
		}
	});

	it.each(fromMinorCases)("draftFromMinor: $name", (c) => {
		const { minor, currency } = c.money;
		const draft = draftFromMinor(minor, c.locale, currency);
		expect(draft).toBe(c.expected);
		expect(parseMoneyInput(draft, c.locale, currency)).toMatchObject({
			ok: true,
			minor,
		});
		expect(formatMoneyDraft(draft, c.locale, currency)).toBe(draft);
	});

	it.each(parseVectors.separators)("separators: $locale", (c) => {
		expect(decimalSeparator(c.locale)).toBe(c.decimal);
		expect(groupSeparator(c.locale)).toBe(c.group);
	});

	it("parses what it formats: every successful parse survives a draft", () => {
		for (const c of parseCases) {
			if (!("minor" in c.expected)) continue;
			const draft = formatMoneyDraft(c.text, c.locale, c.currency);
			expect(
				parseMoneyInput(draft, c.locale, c.currency),
				c.name,
			).toMatchObject({ ok: true, minor: c.expected.minor });
		}
	});
});
