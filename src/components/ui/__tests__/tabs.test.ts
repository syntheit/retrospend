import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { PageTabs } from "~/components/ui/page-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { kit, render } from "./render";

function lineTabs() {
	return render(
		h(
			Tabs,
			{ defaultValue: "a" },
			h(
				TabsList,
				{ variant: "line" },
				h(TabsTrigger, { value: "a", count: 9 }, "Upcoming"),
				h(TabsTrigger, { value: "b" }, "Paused"),
			),
			h(TabsContent, { value: "a" }, "Pane"),
		),
	);
}

describe("Tabs, line variant", () => {
	it("draws underline tabs 40 high with one sliding indicator", () => {
		const html = lineTabs();
		expect(html).toContain('data-variant="line"');
		expect(html).toContain("h-10");
		expect(html).toContain("gap-6");
		expect(html.match(/data-slot="tab-indicator"/g)).toHaveLength(1);
		expect(html).toContain("bg-ds-accent");
		expect(html).toContain("duration-(--t-tab)");
	});

	it("shows counts in fg-3", () => {
		expect(lineTabs()).toMatch(/text-fg-3[^>]*>9</);
	});

	it("animates a pane only after the selection moved", () => {
		const html = lineTabs();
		expect(html).toContain("in-data-[direction]:animate-in");
		expect(html).not.toContain("data-direction");
	});

	it("keeps the old pill tabs as the default", () => {
		const html = render(
			h(
				Tabs,
				{ defaultValue: "a" },
				h(TabsList, null, h(TabsTrigger, { value: "a" }, "One")),
			),
		);
		expect(html).toContain("bg-muted");
		expect(html).not.toContain("tab-indicator");
	});
});

describe("PageTabs", () => {
	const items = [
		{ id: "e", href: "/activity", label: "Expenses" },
		{ id: "r", href: "/activity/recurring", label: "Recurring", count: 11 },
	];

	it("links sibling pages and marks the current one", () => {
		const html = render(h(PageTabs, { items, current: "r" }));
		expect(html).toContain(`aria-label="${kit.tabs?.pages}"`);
		expect(html).toContain('href="/activity"');
		expect(html.match(/aria-current="page"/g)).toHaveLength(1);
		expect(html).toMatch(/aria-current="page"[^>]*>Recurring/);
		expect(html).toContain("tab-indicator");
		expect(html).toMatch(/text-fg-3[^>]*>11</);
	});
});
