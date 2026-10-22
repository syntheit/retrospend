// The golden money vectors from @retrospend/domain, run in the mobile
// toolchain (jest-expo, Babel, the package's exports map). Same JSON files as
// web vitest; a failure here means the phone formats or parses money
// differently from the server and the web.
import {
	type FormatMoneyOptions,
	formatMoney,
	formatMoneyPair,
} from "@retrospend/domain/format";
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
type Expected = { minor: number } | { error: string };

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

interface TextCase {
	name: string;
	locale: string;
	currency: string;
	text: string;
}

interface KeystrokeCase {
	name: string;
	locale: string;
	currency: string;
	keys: string[];
	drafts: string[];
	expected: Expected;
}

interface FromMinorCase {
	name: string;
	locale: string;
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
	c: { locale: string; currency: string },
	expected: Expected,
) {
	const result = parseMoneyInput(text, c.locale, c.currency);
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
	it("has cases (an empty file must not pass)", () => {
		expect(parseCases.length).toBeGreaterThan(0);
		expect(keystrokeCases.length).toBeGreaterThan(0);
	});

	it.each(parseCases)("$name", (c) => {
		expectParse(c.text, c, c.expected);
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
		expectParse(draft, c, c.expected);
	});

	it.each(fromMinorCases)("draftFromMinor: $name", (c) => {
		const { minor, currency } = c.money;
		const draft = draftFromMinor(minor, c.locale, currency);
		expect(draft).toBe(c.expected);
		expectParse(draft, { locale: c.locale, currency }, { minor });
		expect(formatMoneyDraft(draft, c.locale, currency)).toBe(draft);
	});

	it.each(parseVectors.separators)("separators: $locale", (c) => {
		expect(decimalSeparator(c.locale)).toBe(c.decimal);
		expect(groupSeparator(c.locale)).toBe(c.group);
	});
});
