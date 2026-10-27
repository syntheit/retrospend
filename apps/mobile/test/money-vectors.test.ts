// The golden money vectors from @retrospend/domain, run in the mobile
// toolchain (jest-expo, Babel, the package's exports map). Same JSON files as
// web vitest; a failure here means the phone formats or parses money
// differently from the server and the web.
import {
	type FormatMoneyOptions,
	formatMoney,
	formatMoneyPair,
} from "@retrospend/domain/format";
import {
	type NumberFormatChoice,
	withNumberFormat,
} from "@retrospend/domain/format-locale";
import type { Money } from "@retrospend/domain/money-minor";
import {
	decimalSeparator,
	draftFromMinor,
	formatMoneyDraft,
	groupSeparator,
	parseMoneyInput,
} from "@retrospend/domain/parse";
import formatVectors from "@retrospend/domain/vectors/money-format.vectors.json";
import parseVectors from "@retrospend/domain/vectors/money-parse.vectors.json";

type Options = Omit<FormatMoneyOptions, "locale">;

/** A case's locale with its numberFormat setting on it, as every client sets it. */
const loc = (c: { locale: string; numberFormat?: NumberFormatChoice }) =>
	withNumberFormat(c.locale, c.numberFormat);
type Expected = { minor: number } | { error: string };

interface FormatCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	money?: Money | null;
	options?: Options;
	expected?: string | null;
	throws?: string;
}

interface PairCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	original: Money;
	home: Money | null;
	options?: Options;
	expected: { original: string; home: string | null };
}

interface TextCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	currency: string;
	text: string;
}

interface SeparatorCase {
	locale: string;
	numberFormat?: NumberFormatChoice;
	decimal: string;
	group: string;
}

interface KeystrokeCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	currency: string;
	keys: string[];
	drafts: string[];
	expected: Expected;
}

interface FromMinorCase {
	name: string;
	locale: string;
	numberFormat?: NumberFormatChoice;
	money: Money;
	expected: string;
}

const formatCases = formatVectors.format as FormatCase[];
const pairCases = formatVectors.pair as PairCase[];
const parseCases = parseVectors.parse as (TextCase & { expected: Expected })[];
const draftCases = parseVectors.draft as (TextCase & { expected: string })[];
const keystrokeCases = parseVectors.keystrokes as KeystrokeCase[];
const fromMinorCases = parseVectors.draftFromMinor as FromMinorCase[];
const BACKSPACE = "⌫";

function expectParse(
	text: string,
	c: {
		locale: string;
		numberFormat?: NumberFormatChoice;
		currency: string;
	},
	expected: Expected,
) {
	const result = parseMoneyInput(text, loc(c), c.currency);
	if ("minor" in expected) {
		expect(result).toMatchObject({ ok: true, minor: expected.minor });
	} else {
		expect(result).toEqual({ ok: false, error: expected.error });
	}
}

describe("money-format vectors", () => {
	it("has cases (an empty file must not pass)", () => {
		expect(formatCases.length).toBeGreaterThan(0);
		expect(pairCases.length).toBeGreaterThan(0);
	});

	it.each(formatCases)("$name", (c) => {
		const run = () => formatMoney(c.money, { locale: loc(c), ...c.options });
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
	it("has cases (an empty file must not pass)", () => {
		expect(parseCases.length).toBeGreaterThan(0);
		expect(keystrokeCases.length).toBeGreaterThan(0);
	});

	it.each(parseCases)("$name", (c) => {
		expectParse(c.text, c, c.expected);
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
		expectParse(draft, c, c.expected);
	});

	it.each(fromMinorCases)("draftFromMinor: $name", (c) => {
		const { minor, currency } = c.money;
		const draft = draftFromMinor(minor, loc(c), currency);
		expect(draft).toBe(c.expected);
		expectParse(draft, { ...c, currency }, { minor });
		expect(formatMoneyDraft(draft, loc(c), currency)).toBe(draft);
	});

	it.each(parseVectors.separators as SeparatorCase[])("separators: $locale $numberFormat", (c) => {
		expect(decimalSeparator(loc(c))).toBe(c.decimal);
		expect(groupSeparator(loc(c))).toBe(c.group);
	});
});
