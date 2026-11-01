import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Badge } from "~/components/ui/badge";
import { FilterChip } from "~/components/ui/chip";
import { Notice } from "~/components/ui/notice";
import { render } from "./render";

// R7: content never overflows. Text beside a trailing control or a mark gives
// way (min-w-0 with a wrap or a truncate) and the trailing part never shrinks.
// These render the primitives with a 90 character string, the way a long
// name or a German word reaches them, and check that contract in the markup.
const LONG =
	"Cuota del club de tenis con una descripcion muy larga que no termina nunca";

describe("long text in primitives", () => {
	it("Notice keeps its icon and action whole and lets the words wrap", () => {
		const html = render(
			h(Notice, {
				tone: "attention",
				children: LONG,
				action: h("button", { type: "button" }, "Open"),
			}),
		);
		expect(html).toContain('<span class="min-w-0 flex-1">');
		expect(html).toMatch(/<svg[^>]*class="[^"]*shrink-0/);
	});

	it("StatusBadge is never wider than its row and cuts its word with an ellipsis", () => {
		const html = render(h(Badge, { status: "overdue", label: LONG }));
		expect(html).toContain("max-w-full");
		expect(html).toContain('<span class="min-w-0 truncate">');
		expect(html).toMatch(/size-2 shrink-0 rounded-full/);
	});

	it("FilterChip is never wider than its row and cuts its label with an ellipsis", () => {
		const html = render(h(FilterChip, { value: true }, LONG));
		expect(html).toContain("max-w-full");
		expect(html).toContain('<span class="min-w-0 truncate">');
		expect(html).toMatch(
			/<svg[^>]*class="[^"]*shrink-0|\[&amp;_svg\]:shrink-0/,
		);
	});
});
