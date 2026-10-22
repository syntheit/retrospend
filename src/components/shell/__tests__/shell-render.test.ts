import { createElement as h, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "~/components/ui/__tests__/render";

let pathname = "/transactions";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { BottomNav, FloatingAdd } = await import("../bottom-nav");
const { AddSplitButton } = await import("../add-button");
const { SidebarLink } = await import("../nav-link");
const { ShellActionsContext } = await import("../shell-context");

const actions = {
	add: () => {},
	openPalette: () => {},
	openShortcuts: () => {},
	openAccountSheet: () => {},
	openNotificationsSheet: () => {},
	openFeedback: () => {},
};
const withActions = (node: ReactNode) =>
	render(h(ShellActionsContext, { value: actions }, node));

describe("BottomNav", () => {
	it("has the five tabs on today's routes, the current one marked", () => {
		pathname = "/recurring";
		const html = render(h(BottomNav, { badges: { people: 2 } }));
		const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs).toEqual([
			"/dashboard",
			"/transactions",
			"/budget",
			"/people",
			"/projects",
		]);
		expect(html.match(/aria-current="page"/g)).toHaveLength(1);
		expect(html).toMatch(/aria-current="page"[^>]*href="\/transactions"/);
		expect(html).toContain("2 need you");
		expect(html).not.toContain("Wealth");
	});

	it("marks nothing on a page without a tab", () => {
		pathname = "/wealth";
		expect(render(h(BottomNav))).not.toContain("aria-current");
	});
});

describe("Add", () => {
	it("the split button adds an expense and offers more ways in a menu", () => {
		const html = withActions(h(AddSplitButton));
		expect(html).toContain('role="group"');
		expect(html).toContain(">Add expense</span>");
		expect(html).toContain('aria-label="More ways to add"');
		expect(html).toContain('aria-haspopup="menu"');
	});

	it("the floating Add says what it adds", () => {
		const html = withActions(h(FloatingAdd));
		expect(html).toContain('aria-label="Add expense"');
		expect(html).toContain("shadow-menu");
	});
});

describe("SidebarLink", () => {
	it("marks the current page and shows a Needs you count with words", () => {
		const html = render(
			h(SidebarLink, {
				href: "/people",
				lead: null,
				label: "People",
				current: true,
				badge: 120,
			}),
		);
		expect(html).toContain('aria-current="page"');
		expect(html).toContain(">99+</span>");
		expect(html).toContain("120 need you");
	});

	it("draws no badge for zero", () => {
		const html = render(
			h(SidebarLink, {
				href: "/x",
				lead: null,
				label: "X",
				current: false,
				badge: 0,
			}),
		);
		expect(html).not.toContain("need");
		expect(html).not.toContain("aria-current");
	});
});
