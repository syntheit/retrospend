import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips, FilterMenu } from "~/components/ui/chip";
import { nextEnabled, Segmented } from "~/components/ui/segmented";
import { kit, render } from "./render";

describe("Button kinds", () => {
	it("draws the design's button at control height, type button", () => {
		const html = render(h(Button, { kind: "primary" }, "Add expense"));
		expect(html).toContain('data-kind="primary"');
		expect(html).toContain("h-ctl");
		expect(html).toContain("bg-brand");
		expect(html).toContain('type="button"');
	});

	it("has secondary, ghost and danger, and a small size", () => {
		expect(render(h(Button, { kind: "secondary" }, "Cancel"))).toContain(
			"border-line-strong",
		);
		expect(render(h(Button, { kind: "ghost" }, "More"))).toContain("text-fg-2");
		expect(render(h(Button, { kind: "danger" }, "Delete"))).toContain(
			"bg-danger",
		);
		expect(
			render(h(Button, { kind: "secondary", size: "sm" }, "Confirm")),
		).toContain("h-ctl-sm");
	});

	it("makes icon-only buttons square", () => {
		const html = render(
			h(Button, { kind: "ghost", icon: true, "aria-label": "More" }, "x"),
		);
		expect(html).toContain("w-ctl");
		expect(html).toContain('aria-label="More"');
	});

	it("keeps its width while loading and blocks presses", () => {
		const html = render(h(Button, { kind: "primary", loading: true }, "Save"));
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("invisible");
		expect(html).toContain("animate-spin");
	});

	it("keeps the old look for today's pages", () => {
		const html = render(h(Button, { variant: "outline" }, "Old"));
		expect(html).toContain('data-variant="outline"');
		expect(html).not.toContain("data-kind");
	});
});

describe("Segmented", () => {
	const options = [
		{ value: "a", label: "Expenses" },
		{ value: "b", label: "Summary", disabled: true },
		{ value: "c", label: "People" },
	];

	it("is a radio group with one checked, focusable option", () => {
		const html = render(
			h(Segmented, { options, value: "c", onChange: () => {}, label: "View" }),
		);
		expect(html).toContain('role="radiogroup"');
		expect(html).toContain('aria-label="View"');
		expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
		expect(html).toContain("bg-surface text-fg shadow-ctl");
		expect(html).toContain("h-ctl");
	});

	it("moves with the arrows, skipping disabled options and wrapping", () => {
		expect(nextEnabled(options, 0, 1)).toBe(2);
		expect(nextEnabled(options, 2, 1)).toBe(0);
		expect(nextEnabled(options, 0, -1)).toBe(2);
	});
});

describe("FilterChips", () => {
	it("marks a toggle chip with aria-pressed and the brand-soft fill", () => {
		const on = render(h(FilterChip, { selected: true }, "Groceries"));
		expect(on).toContain('aria-pressed="true"');
		expect(on).toContain("bg-brand-soft");
		expect(on).toContain("h-ctl");
		const off = render(h(FilterChip, null, "Groceries"));
		expect(off).toContain('aria-pressed="false"');
		expect(off).not.toContain("bg-brand-soft");
	});

	it("draws a value chip neutral with a chevron and no pressed state", () => {
		const html = render(h(FilterChip, { value: true }, "Oct 2026"));
		expect(html).not.toContain("aria-pressed");
		expect(html).toContain("lucide-chevron-down");
		expect(html).toContain("bg-surface");
	});

	it("puts the chips and the Filter menu in one row", () => {
		const html = render(
			h(
				FilterChips,
				null,
				h(FilterChip, { selected: true }, "Unreviewed"),
				h(FilterMenu, {
					groups: [
						{
							id: "cat",
							label: "Category",
							items: [{ id: "g", label: "Groceries", checked: false }],
						},
					],
					onToggle: () => {},
				}),
			),
		);
		expect(html).toContain("flex-wrap");
		expect(html).toContain(`${kit.filter?.menu}</button>`);
		expect(html).toContain('aria-haspopup="menu"');
	});
});
