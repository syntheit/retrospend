import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { NeedsYouList } from "~/components/needs-you/needs-you-list";
import type { NeedsYouItemVM } from "~/components/needs-you/types";
import { render } from "~/components/ui/__tests__/render";

const text = (html: string) =>
	html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const FROM: NeedsYouItemVM = {
	id: "p1",
	kind: "confirmPayment",
	person: "Lucía",
	amount: { minor: 2000000, currency: "ARS" },
	face: { id: "lucia", name: "Lucía Fernández" },
	context: "Mercado Pago",
	secondary: "notReceived",
};

describe("NeedsYouItem from a person", () => {
	it("leads with the face instead of the kind's icon", () => {
		const withFace = render(h(NeedsYouList, { items: [FROM] }));
		const withIcon = render(
			h(NeedsYouList, { items: [{ ...FROM, face: undefined }] }),
		);
		expect(withFace).toContain('data-slot="avatar"');
		expect(withFace).not.toContain("lucide-circle-check");
		expect(withIcon).not.toContain('data-slot="avatar"');
		expect(withIcon).toContain("lucide-circle-check");
	});

	it("offers the second action only with its handler", () => {
		const bare = text(render(h(NeedsYouList, { items: [FROM] })));
		expect(bare).not.toContain("Not received?");
		const t = text(
			render(h(NeedsYouList, { items: [FROM], onSecondary: () => undefined })),
		);
		expect(t).toContain("Mercado Pago · Not received?");
	});

	it("ends with the three-dot menu only when it has handlers", () => {
		const none = render(h(NeedsYouList, { items: [FROM] }));
		expect(none).not.toContain('aria-haspopup="menu"');
		const html = render(
			h(NeedsYouList, { items: [FROM], menu: { open: () => undefined } }),
		);
		expect(html).toContain('aria-haspopup="menu"');
	});
});
