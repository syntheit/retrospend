import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { BackButton, PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { Section } from "~/components/layout/section";
import { render } from "~/components/ui/__tests__/render";
import { Button } from "~/components/ui/button";

describe("PageFrame and BackButton", () => {
	it("marks a v2 page and leaves a loading fallback unmarked", () => {
		const page = render(h(PageFrame, { label: "wealth", children: "C" }));
		expect(page).toContain('data-page="wealth"');
		expect(page).toContain('data-ui="v2"');
		expect(page).toContain("max-w-280");
		const fallback = render(h(PageFrame, { children: "C" }));
		expect(fallback).not.toContain("data-ui");
	});

	it("is a link named for where it goes, on phones only", () => {
		const html = render(h(BackButton, { href: "/people", label: "People" }));
		expect(html).toMatch(/<a[^>]*href="\/people"/);
		expect(html).toContain('aria-label="People"');
		expect(html).toContain("md:hidden");
	});
});

describe("Section end slot", () => {
	it("puts one control at the end of the heading row instead of the link", () => {
		const html = render(
			h(Section, {
				id: "who",
				title: "Who paid what",
				action: { label: "See all", href: "/x" },
				end: h(Button, { kind: "secondary" }, "Paid"),
				children: "Body",
			}),
		);
		expect(html).toContain(">Paid</button>");
		expect(html).not.toContain('href="/x"');
		expect(html).toContain("min-h-ctl");
	});
});

describe("PageHeader sub line", () => {
	it("is one element: under the title from md, under the whole row on phones", () => {
		const html = render(
			h(PageHeader, { title: "Currencies", sub: "Rates as of today" }),
		);
		expect(html.match(/Rates as of today/g)).toHaveLength(1);
		expect(html).toContain("col-span-3");
		expect(html).toContain("md:col-start-2");
	});
});
