import vectors from "@retrospend/domain/vectors/money-format.vectors.json";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { AvailablePill } from "~/components/money/available-pill";
import { Balance } from "~/components/money/balance";
import type { FormatMoneyOptions, MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { kit, render } from "~/components/ui/__tests__/render";

const ars = (minor: number): MoneyValue => ({ minor, currency: "ARS" });
const usd = (minor: number): MoneyValue => ({ minor, currency: "USD" });
const NB = " ";

/** The text of every money span, in order. */
const amounts = (html: string) =>
	[...html.matchAll(/data-slot="money"[^>]*>([^<]*)</g)].map((m) => m[1]);

type Options = Omit<FormatMoneyOptions, "locale">;
type FormatCase = {
	name: string;
	locale: string;
	money?: MoneyValue | null;
	options?: Options;
	expected?: string | null;
	throws?: string;
};
type PairCase = {
	name: string;
	locale: string;
	original: MoneyValue;
	home: MoneyValue | null;
	options?: Options;
	expected: { original: string; home: string | null };
};

describe("approximate figures", () => {
	it("a converted figure reads ≈ inside its money span, tags unchanged", () => {
		const html = render(h(Money, { value: ars(130300000), approx: true }));
		expect(amounts(html)).toEqual([`≈ ARS${NB}1,303,000`]);
		expect(html).toContain('data-minor="130300000"');
	});

	it("Balance passes it on and can drop its words inside a titled group", () => {
		const html = render(
			h(Balance, { amount: ars(-3620000), approx: true, words: false }),
		);
		expect(amounts(html)).toEqual([`≈ ARS${NB}36,200`]);
		expect(html).not.toContain("you owe");
	});
});

describe("golden vectors through the components", () => {
	const format = (vectors.format as FormatCase[]).filter((c) => !c.throws);
	const pair = vectors.pair as PairCase[];

	it.each(format)("Money: $name", (c) => {
		const html = render(
			h(Money, { value: c.money ?? null, ...c.options }),
			c.locale,
		);
		expect(amounts(html)).toEqual([c.expected ?? kit.money?.none]);
	});

	it.each(pair)("Money.pair: $name", (c) => {
		const html = render(
			h(Money.pair, { original: c.original, home: c.home, ...c.options }),
			c.locale,
		);
		// Same currency: one amount. A missing home amount says No rate yet.
		const same = c.home != null && c.home.currency === c.original.currency;
		const homeText = c.expected.home ?? (same ? undefined : kit.money?.noRate);
		expect(amounts(html)).toEqual(
			homeText ? [c.expected.original, homeText] : [c.expected.original],
		);
	});
});

describe("Money", () => {
	it("formats in the page locale, tabular, never wrapped", () => {
		const html = render(h(Money, { value: ars(123456700) }), "es-AR");
		expect(amounts(html)).toEqual([`ARS${NB}1.234.567`]);
		expect(html).toContain("tabular-nums");
		expect(html).toContain("whitespace-nowrap");
	});

	it("a rate with more places than the currency keeps its digits", () => {
		const html = render(h(Money, { value: usd(64), places: 5 }));
		expect(amounts(html)).toEqual([`USD${NB}0.00064`]);
	});

	it("carries the figure attributes for the audit", () => {
		const html = render(
			h(Money, { value: usd(-6340), figure: "monthSpend.total" }),
		);
		expect(html).toContain('data-figure="monthSpend.total"');
		expect(html).toContain('data-minor="-6340"');
		expect(html).toContain('data-currency="USD"');
		expect(amounts(html)).toEqual([`-USD${NB}63.40`]);
	});

	it("says a missing amount in a muted word, with no minor", () => {
		const html = render(
			h(Money, { value: null, missing: "noRate", figure: "x" }),
		);
		expect(html).toContain("text-fg-3");
		expect(html).toContain(kit.money?.noRate);
		expect(html).toContain('data-figure="x"');
		expect(html).not.toContain("data-minor");
	});
});

describe("Money.pair", () => {
	it("shows the original first and the home amount muted under it", () => {
		const html = render(
			h(Money.pair, {
				original: usd(6340),
				home: ars(8952900),
				figure: "e.original",
				homeFigure: "e.home",
			}),
		);
		expect(amounts(html)).toEqual([`USD${NB}63.40`, `ARS${NB}89,529`]);
		expect(html).toContain("flex-col items-end");
		expect(html).toMatch(/text-fg-3 tabular-nums text-meta/);
		expect(html).toContain('data-figure="e.home"');
		expect(html).toContain('data-minor="8952900"');
	});

	it("puts them on one line when inline", () => {
		const html = render(
			h(Money.pair, { original: usd(6340), home: ars(8952900), inline: true }),
		);
		expect(html).toContain("items-baseline");
	});

	it("says No rate yet when the home amount is missing", () => {
		const html = render(h(Money.pair, { original: usd(6340), home: null }));
		expect(amounts(html)).toEqual([`USD${NB}63.40`, kit.money?.noRate]);
	});

	it("shows one amount when there is nothing to convert", () => {
		const html = render(h(Money.pair, { original: ars(500), home: ars(500) }));
		expect(amounts(html)).toHaveLength(1);
	});
});

describe("Balance", () => {
	it("says owes you in the owed tone, the words carrying the sign", () => {
		const html = render(h(Balance, { amount: ars(80235200), figure: "b" }));
		expect(html).toContain("text-positive");
		expect(html).toContain(kit.balance?.owesYou);
		expect(amounts(html)).toEqual([`ARS${NB}802,352`]);
		expect(html).toContain('data-figure="b"');
	});

	it("says you owe in plain text, never an alarm color, no minus", () => {
		const html = render(h(Balance, { amount: ars(-3620000) }));
		expect(html).toContain("text-owe");
		expect(html).toContain(kit.balance?.youOwe);
		expect(amounts(html)).toEqual([`ARS${NB}36,200`]);
		expect(html).not.toMatch(/attention|danger/);
	});

	it("is the Settled status at zero, still audited", () => {
		const html = render(h(Balance, { amount: ars(0), figure: "b" }));
		expect(html).toContain(kit.status?.settled);
		expect(html).toContain("text-fg-3");
		expect(html).toContain('data-minor="0"');
	});

	it("picks the words for people and for you", () => {
		expect(
			render(h(Balance, { amount: ars(100), subject: "people" })),
		).toContain(kit.balance?.peopleOweYou);
		expect(render(h(Balance, { amount: ars(100), subject: "you" }))).toContain(
			kit.balance?.owedToYou,
		);
		expect(
			render(h(Balance, { amount: ars(-100), subject: "people" })),
		).toContain(kit.balance?.youOwePeople);
	});
});

describe("AvailablePill", () => {
	it("pairs the amount with its status word in the funded tone", () => {
		const html = render(
			h(AvailablePill, { amount: ars(5680000), status: "funded" }),
		);
		expect(html).toContain("text-positive");
		expect(html).toContain("border-positive/55");
		expect(html).not.toContain("bg-attention-bg");
		expect(html).toContain(kit.status?.funded);
		expect(amounts(html)).toEqual([`ARS${NB}56,800`]);
	});

	it("fills underfunded and overspent with attention, no minus", () => {
		for (const status of ["underfunded", "overspent"] as const) {
			const html = render(h(AvailablePill, { amount: ars(-4840000), status }));
			expect(html).toContain("bg-attention-bg");
			expect(html).toContain("text-attention-text");
			expect(html).toContain(kit.status?.[status]);
			expect(amounts(html)).toEqual([`ARS${NB}48,400`]);
		}
	});

	it("turns neutral when funded at zero", () => {
		const html = render(h(AvailablePill, { amount: ars(0), status: "funded" }));
		expect(html).toContain("border-line-strong text-fg-2");
		expect(html).not.toContain("text-positive");
	});
});
