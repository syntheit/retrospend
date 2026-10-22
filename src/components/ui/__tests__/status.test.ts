import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Badge } from "~/components/ui/badge";
import { STATUS, type StatusKind, StatusDot } from "~/components/ui/status-dot";
import { kit, render } from "./render";

const kinds = Object.keys(STATUS) as StatusKind[];

describe("the one status map (R5)", () => {
	it("has the 17 kinds", () => {
		expect(kinds).toEqual([
			"owed",
			"owe",
			"settled",
			"funded",
			"underfunded",
			"overspent",
			"pending",
			"confirmed",
			"overdue",
			"due",
			"review",
			"importing",
			"error",
			"notOnRetrospend",
			"upcoming",
			"noRate",
			"rejected",
		]);
	});

	it("gives every kind an English word (status is never color alone)", () => {
		for (const kind of kinds) {
			const word = kit.status?.[STATUS[kind].word];
			expect(word, kind).toBeTruthy();
			expect(render(h(StatusDot, { kind }))).toContain(`>${word}</span>`);
		}
	});

	it("colors the dot and the word from the tone", () => {
		const owed = render(h(StatusDot, { kind: "owed" }));
		expect(owed).toContain("text-positive");
		expect(owed).toContain("bg-positive");
		const owe = render(h(StatusDot, { kind: "owe" }));
		expect(owe).toContain("text-owe");
		const overdue = render(h(StatusDot, { kind: "overdue" }));
		expect(overdue).toContain("text-attention-text");
		expect(overdue).toContain("bg-attention");
	});

	it("hides the dot from screen readers and takes a specific label", () => {
		const html = render(
			h(StatusDot, {
				kind: "overdue",
				label: "Overdue since Oct 3",
				size: "sm",
			}),
		);
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("Overdue since Oct 3");
		expect(html).toContain("text-meta");
	});
});

describe("Badge", () => {
	it("draws a status kind as a pill with the map's word and tone fill", () => {
		const html = render(h(Badge, { status: "pending" }));
		expect(html).toContain('data-status="pending"');
		expect(html).toContain("bg-info-bg");
		expect(html).toContain(kit.status?.pending);
	});

	it("keeps the old look when a page passes variant", () => {
		const html = render(h(Badge, { variant: "secondary" }, "Old"));
		expect(html).toContain("bg-secondary");
		expect(html).not.toContain("data-status");
	});
});
