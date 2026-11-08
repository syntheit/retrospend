// Server-rendered markup of the composer's "What this changes" block (vitest
// runs in node here): a foreign expense leads with the home figure.
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { MoneyPrefsValue } from "~/components/money/use-money-locale";
import { render } from "~/components/ui/__tests__/render";
import { ChangesBlock, type PreviewDiff } from "../changes";

const html = (diff: PreviewDiff) =>
	render(
		h(
			MoneyPrefsValue,
			{ value: { homeCurrency: "ARS" } },
			h(ChangesBlock, { diff }),
		),
	);

/** The text of the spending line, tags removed. */
const spentLine = (markup: string) => {
	const line = markup
		.split("<div")
		.find((part) => part.includes('data-figure="preview.spent.delta"'));
	return (line ?? "")
		.replace(/^[^>]*>/, "")
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();
};

describe("ChangesBlock spending line", () => {
	// 10 USD at 1 USD = 1,545 ARS: the home figure is 15,450 ARS.
	const foreign: PreviewDiff = {
		changes: [
			{
				id: "spent",
				currency: "USD",
				before: { minor: 0, currency: "USD" },
				after: { minor: 1000, currency: "USD" },
				delta: { minor: 1000, currency: "USD" },
			},
			{
				id: "glance.spent",
				currency: "ARS",
				before: { minor: 0, currency: "ARS" },
				after: { minor: 1_545_000, currency: "ARS" },
				delta: { minor: 1_545_000, currency: "ARS" },
			},
		],
		unchanged: [],
		unavailable: [],
	};

	it("leads with the home figure and puts the original second, with its ISO code", () => {
		const markup = html(foreign);
		const home = markup.indexOf('data-figure="preview.glance.spent.delta"');
		const original = markup.indexOf('data-figure="preview.spent.delta"');
		expect(home).toBeGreaterThan(-1);
		expect(original).toBeGreaterThan(home);
		const line = spentLine(markup);
		// Home first (ARS carries the one symbol), original second with its code.
		expect(line).toBe("Your spending+$15,450→ $15,450(+USD 10.00)");
	});

	it("shows the original alone when the spending is in the home currency", () => {
		const markup = html({
			changes: [
				{
					id: "spent",
					currency: "ARS",
					before: { minor: 0, currency: "ARS" },
					after: { minor: 1_545_000, currency: "ARS" },
					delta: { minor: 1_545_000, currency: "ARS" },
				},
			],
			unchanged: [],
			unavailable: [],
		});
		expect(markup).not.toContain("preview.glance.spent");
		expect(markup).not.toContain("(+");
	});
});
