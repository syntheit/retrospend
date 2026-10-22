import { Inbox } from "lucide-react";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "~/components/ui/button";
import { Empty, EmptyState } from "~/components/ui/empty-state";
import { Notice } from "~/components/ui/notice";
import { Skeleton, SkeletonRows } from "~/components/ui/skeleton";
import { Tip } from "~/components/ui/tooltip";
import { render } from "./render";

describe("Empty", () => {
	it("is one line, a hint and at most one action", () => {
		const html = render(
			h(Empty, {
				icon: Inbox,
				title: "No recurring expenses",
				hint: "Add one to see when it is due.",
				action: h(Button, { kind: "secondary", size: "sm" }, "Add"),
			}),
		);
		expect(html).toContain("font-semibold text-body text-fg");
		expect(html).toContain("text-fg-2 text-small");
		expect(html).toContain("size-6 text-fg-3");
		expect(html.match(/<button/g)).toHaveLength(1);
	});

	it("leaves EmptyState as it was", () => {
		const html = render(
			h(EmptyState, { icon: Inbox, title: "Old", description: "Old look" }),
		);
		expect(html).toContain("rounded-full bg-muted/50");
	});
});

describe("Notice", () => {
	it("fills by tone with no border or stripe", () => {
		const html = render(
			h(Notice, {
				tone: "attention",
				children: "Rate for BRL is from Oct 18.",
			}),
		);
		expect(html).toContain("bg-attention-bg");
		expect(html).toContain('role="status"');
		expect(html).not.toMatch(/border/);
	});

	it("alerts for errors and takes one action", () => {
		const html = render(
			h(Notice, {
				tone: "danger",
				action: h(Button, { kind: "secondary", size: "sm" }, "Retry"),
				children: "Could not reach the server.",
			}),
		);
		expect(html).toContain('role="alert"');
		expect(html).toContain("bg-danger-bg");
		expect(html).toContain("Retry");
	});
});

describe("Skeleton", () => {
	it("draws the design's shapes in raised, hidden from screen readers", () => {
		const html = render(h(Skeleton, { shape: "money" }));
		expect(html).toContain("bg-raised");
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("animate-pulse");
	});

	it("draws rows in place at row height", () => {
		const html = render(h(SkeletonRows, { count: 2 }));
		expect(html).toContain('aria-busy="true"');
		expect(html.match(/min-h-row/g)).toHaveLength(2);
	});

	it("keeps the old look without a shape", () => {
		expect(render(h(Skeleton))).toContain("bg-accent");
	});
});

describe("Tip", () => {
	it("wraps its trigger without drawing content until opened", () => {
		const html = render(
			h(Tip, {
				content: "About rates",
				children: h("span", null, "USD 63.40"),
			}),
		);
		expect(html).toContain("USD 63.40");
		expect(html).toContain('data-state="closed"');
		expect(html).not.toContain("About rates");
	});
});
