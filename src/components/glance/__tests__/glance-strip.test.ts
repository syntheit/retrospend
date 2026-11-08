// Server-rendered markup of Home's glance strip (vitest runs in node here):
// the dollar row never shows a rate under 1.
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { MoneyPrefsValue } from "~/components/money/use-money-locale";
import { render } from "~/components/ui/__tests__/render";
import { type GlanceRow, GlanceStrip, type GlanceVM } from "../glance-strip";

const strip = (home: string, row: GlanceRow) => {
	const glance: GlanceVM = {
		month: "2026-10-01",
		spent: null,
		line: { kind: "noBudget" },
		fasterThanPlanned: false,
		pace: { current: [], previous: [] } as unknown as GlanceVM["pace"],
		rows: [row],
	};
	return render(
		h(
			MoneyPrefsValue,
			{ value: { homeCurrency: home } },
			h(GlanceStrip, { glance, variant: "B" }),
		),
	);
};

/** The text of the dollar row's amount: the part after its label. */
const amountOf = (markup: string) =>
	(markup.match(/data-figure="glance\.dollar"[^>]*>([^<]*)</) ?? [])[1]
		// The formatter joins a code and its number with a no-break space.
		?.replace(/\s/g, " ");

describe("GlanceStrip dollar row", () => {
	it("flips a euro home's dollar price under 1 into the pair at least 1", () => {
		// 1 USD = 0.92 EUR, so 1 EUR = 1 / 0.92 = 1.08695... USD, shown to 4
		// places with trailing zeros trimmed down to 2: 1.087.
		const markup = strip("EUR", {
			id: "dollarToday",
			amount: { minor: 92, currency: "EUR" },
			href: "/currencies",
			figure: "glance.dollar",
			code: true,
			rateLabel: "Official",
			rate: "0.92",
		});
		expect(amountOf(markup)).toBe("1 EUR = 1.087 USD");
		expect(markup).not.toContain("0.92");
	});

	it("keeps USD as the unit when the rate is already at least 1 (ARS home)", () => {
		// 1 USD = 1,545 ARS: no flip, so the Money amount reads with its code
		// (a whole amount drops its cents).
		const markup = strip("ARS", {
			id: "dollarToday",
			amount: { minor: 154_500, currency: "ARS" },
			href: "/currencies",
			figure: "glance.dollar",
			code: true,
			rateLabel: "Blue",
			rate: "1545",
		});
		expect(amountOf(markup)).toBe("ARS 1,545");
		expect(markup).not.toContain("1 ARS =");
	});
});
