import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "~/components/layout/page-header";
import { Section } from "~/components/layout/section";
import { SummaryLine } from "~/components/layout/summary-line";
import { Toolbar } from "~/components/layout/toolbar";
import { Button } from "~/components/ui/button";
import { render } from "~/components/ui/__tests__/render";

describe("PageHeader", () => {
	it("has the title, one primary and the overflow on one row", () => {
		const html = render(
			h(PageHeader, {
				title: "Projects",
				primary: h(Button, { kind: "primary" }, "New project"),
				overflow: h(Button, {
					kind: "ghost",
					icon: true,
					"aria-label": "More",
				}),
			}),
		);
		expect(html).toMatch(/<h1 class="[^"]*text-title[^"]*">Projects<\/h1>/);
		expect(html).toContain("mb-4");
		expect(html.match(/<button/g)).toHaveLength(2);
	});

	it("draws one sub line and the tabs only when given", () => {
		const bare = render(h(PageHeader, { title: "Activity" }));
		expect(bare).not.toContain("text-small");
		const full = render(
			h(PageHeader, { title: "Depto Palermo", sub: "Since Mar 2", tabs: "T" }),
		);
		expect(full).toContain("text-fg-3 text-small");
		expect(full).toContain("Since Mar 2");
	});
});

describe("Toolbar", () => {
	it("is one row with the view switch at the end", () => {
		const html = render(
			h(Toolbar, { label: "Filter expenses", search: "S", end: "V" }, "C"),
		);
		expect(html).toContain('role="group"');
		expect(html).toContain('aria-label="Filter expenses"');
		expect(html).toContain("flex-wrap items-center gap-2");
		expect(html).toContain('<div class="ml-auto flex items-center">V</div>');
	});
});

describe("Section", () => {
	it("is flat: heading, count, one link, content, no border", () => {
		const html = render(
			h(Section, {
				id: "active",
				title: "Active",
				count: 2,
				action: { label: "See all", href: "/projects" },
				children: "Body",
			}),
		);
		expect(html).toContain('aria-labelledby="active-title"');
		expect(html).toContain("mt-8 first:mt-0");
		expect(html).toContain("text-section");
		expect(html).toMatch(/text-fg-3[^>]*>2</);
		expect(html).toContain('href="/projects"');
		expect(html).not.toContain("border");
	});
});

describe("SummaryLine", () => {
	it("joins label and value pairs with a middle dot", () => {
		const html = render(
			h(SummaryLine, {
				items: [
					{ key: "s", label: "Spent", value: "ARS 2,706,602" },
					{ key: "l", label: "Left", value: "ARS 59,161" },
				],
			}),
		);
		expect(html.match(/·/g)).toHaveLength(1);
		expect(html).toContain("font-semibold text-fg tabular-nums");
		expect(html).toContain("Spent");
		expect(html).toContain("ARS 59,161");
	});
});
