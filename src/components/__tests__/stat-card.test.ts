import { Clock } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatCard } from "~/components/ui/stat-card";
import { formatCurrency } from "~/lib/utils";

const formatArs = (value: number) => formatCurrency(value, "ARS");

function render(trendValue: number, label = "vs daily avg") {
	return renderToStaticMarkup(
		createElement(StatCard, {
			title: "Last 24 Hours",
			icon: Clock,
			value: formatArs(25_400),
			formatMoney: formatArs,
			trend: { value: trendValue, label, isMoney: true, forceNeutral: true },
		}),
	);
}

describe("StatCard money trend", () => {
	it("formats with the bound currency and puts the sign in front", () => {
		const html = render(-93_678.59);
		expect(html).toContain(`-${formatArs(93_678.59)}`);
		expect(html).not.toContain("$-");
		expect(html).not.toContain("US$");
	});

	it("marks increases with a plus", () => {
		expect(render(1_000)).toContain(`+${formatArs(1_000)}`);
	});

	it("keeps the whole trend label", () => {
		expect(render(-5)).toContain("vs daily avg");
	});
});
