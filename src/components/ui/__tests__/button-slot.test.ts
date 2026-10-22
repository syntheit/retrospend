import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "~/components/ui/button";
import { render } from "./render";

describe("Button asChild", () => {
	it("styles its one child (a link) instead of wrapping it", () => {
		const html = render(
			h(
				Button,
				{ asChild: true, kind: "ghost" },
				h("a", { href: "/people" }, "People"),
			),
		);
		expect(html).toMatch(/^<a [^>]*href="\/people"/);
		expect(html).toContain('data-kind="ghost"');
		expect(html).not.toContain("<button");
	});

	it("never adds the spinner to a slotted child, even when loading", () => {
		const html = render(
			h(
				Button,
				{ asChild: true, kind: "primary", loading: true },
				h("a", { href: "/x" }, "Go"),
			),
		);
		expect(html).not.toContain('aria-busy="true"');
		expect(html).not.toContain("animate-spin");
	});
});
