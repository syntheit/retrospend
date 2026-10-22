import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";
import { AvailablePill } from "~/components/money/available-pill";
import { Balance } from "~/components/money/balance";
import type { FormatMoneyOptions, MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { kit, render } from "~/components/ui/__tests__/render";

// A stand-in that shows what the components asked the formatter for, so the
// tests check layout and options, not number formatting (that is the
// formatter's own golden-vector suite).
const calls: { money: MoneyValue; opts: FormatMoneyOptions }[] = [];
vi.mock("~/components/money/format", async (orig) => ({
	...(await orig<typeof import("~/components/money/format")>()),
	formatMoney: (money: MoneyValue, opts: FormatMoneyOptions) => {
		calls.push({ money, opts });
		return `[${money.currency} ${money.minor} ${opts.sign}]`;
	},
}));

const ars = (minor: number): MoneyValue => ({ minor, currency: "ARS" });

describe("Money", () => {
	it("formats through the one formatter with the page locale", () => {
		calls.length = 0;
		const html = render(h(Money, { value: ars(123456700) }), "es-AR");
		expect(html).toContain("[ARS 123456700 auto]");
		expect(html).toContain("tabular-nums");
		expect(html).toContain("whitespace-nowrap");
		expect(calls[0]?.opts).toEqual({
			locale: "es-AR",
			display: "code",
			sign: "auto",
			cents: "auto",
		});
	});

	it("says a missing amount in a muted word", () => {
		const html = render(h(Money, { value: null, missing: "noRate" }));
		expect(html).toContain("text-fg-3");
		expect(html).toContain(kit.money?.noRate);
	});
});

describe("Money.pair", () => {
	const usd: MoneyValue = { minor: 6340, currency: "USD" };

	it("shows the original first and the home amount muted under it", () => {
		const html = render(h(Money.pair, { original: usd, home: ars(8952900) }));
		expect(html.indexOf("[USD 6340")).toBeLessThan(
			html.indexOf("[ARS 8952900"),
		);
		expect(html).toContain("flex-col items-end");
		expect(html).toMatch(/text-fg-3 text-meta[^>]*>\[ARS/);
	});

	it("puts them on one line when inline", () => {
		const html = render(
			h(Money.pair, { original: usd, home: ars(8952900), inline: true }),
		);
		expect(html).toContain("items-baseline");
	});

	it("says No rate yet when the home amount is missing", () => {
		const html = render(h(Money.pair, { original: usd, home: null }));
		expect(html).toContain(kit.money?.noRate);
	});

	it("shows one amount when there is nothing to convert", () => {
		const html = render(h(Money.pair, { original: ars(500), home: ars(500) }));
		expect(html.match(/\[ARS 500/g)).toHaveLength(1);
		expect(html).not.toContain("money-pair");
	});
});

describe("Balance", () => {
	it("says owes you in positive, the words carrying the sign", () => {
		const html = render(h(Balance, { amount: ars(80235200) }));
		expect(html).toContain("text-positive");
		expect(html).toContain(kit.balance?.owesYou);
		expect(html).toContain("[ARS 80235200 never]");
	});

	it("says you owe in plain text, never an alarm color", () => {
		const html = render(h(Balance, { amount: ars(-3620000) }));
		expect(html).toContain("text-owe");
		expect(html).toContain(kit.balance?.youOwe);
		expect(html).not.toMatch(/attention|danger/);
	});

	it("says Settled at zero and picks words for people and you", () => {
		expect(render(h(Balance, { amount: ars(0) }))).toContain(
			kit.status?.settled,
		);
		expect(render(h(Balance, { amount: ars(1), subject: "people" }))).toContain(
			kit.balance?.peopleOweYou,
		);
		expect(render(h(Balance, { amount: ars(1), subject: "you" }))).toContain(
			kit.balance?.owedToYou,
		);
	});

	it("reads a bigint amount", () => {
		expect(
			render(h(Balance, { amount: { minor: -5n, currency: "ARS" } })),
		).toContain(kit.balance?.youOwe);
	});
});

describe("AvailablePill", () => {
	it("pairs the amount with its status word", () => {
		const html = render(
			h(AvailablePill, { amount: ars(5680000), status: "funded" }),
		);
		expect(html).toContain("text-positive");
		expect(html).toContain(kit.status?.funded);
		expect(html).toContain("[ARS 5680000 never]");
	});

	it("fills underfunded and overspent with attention", () => {
		for (const status of ["underfunded", "overspent"] as const) {
			const html = render(h(AvailablePill, { amount: ars(-4840000), status }));
			expect(html).toContain("bg-attention-bg");
			expect(html).toContain("text-attention-text");
			expect(html).toContain(kit.status?.[status]);
		}
	});

	it("turns neutral when funded at zero", () => {
		const html = render(h(AvailablePill, { amount: ars(0), status: "funded" }));
		expect(html).toContain("border-line-strong text-fg-2");
		expect(html).not.toContain("text-positive");
	});
});

describe("golden vectors", () => {
	// Turn on when feature/s0b-formatter lands: format.ts then re-exports
	// formatMoney from @retrospend/domain, and every case in
	// packages/domain/vectors/money-format.vectors.json must render through
	// <Money> exactly as the formatter prints it.
	it.skip("Money renders packages/domain/vectors/money-format.vectors.json", () => {
		expect.fail("formatMoney is not merged yet");
	});
});
