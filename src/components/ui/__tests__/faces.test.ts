import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	Face,
	FaceStack,
	faceColor,
	initialsOf,
	orderFaces,
	splitFaces,
} from "~/components/ui/avatar-face";
import { render } from "./render";

vi.mock("~/components/money/format", async (orig) => ({
	...(await orig<typeof import("~/components/money/format")>()),
	formatMoney: (m: { minor: number; currency: string }) =>
		`${m.currency} ${m.minor}`,
}));

const people = [
	{ id: "me", name: "Daniel Vega", isSelf: true },
	{ id: "lucia", name: "Lucía Fernández" },
	{ id: "martin", name: "Martín Alvarez" },
	{ id: "paz", name: "Paz" },
	{ id: "juan", name: "Juan Cruz" },
];

describe("Face", () => {
	it("takes a color from the name's char codes mod 8, the same every time", () => {
		// "Paz": 80 + 97 + 122 = 299, 299 mod 8 = 3, the fourth color.
		expect(faceColor("Paz")).toBe("bg-avatar-4");
		expect(faceColor("Paz")).toBe(faceColor("Paz"));
	});

	it("uses first and last initials, or two letters of one word", () => {
		expect(initialsOf("Lucía Fernández")).toBe("LF");
		expect(initialsOf("Juan Carlos Cruz")).toBe("JC");
		expect(initialsOf("paz")).toBe("PA");
		expect(initialsOf("  ")).toBe("?");
	});

	it("draws initials on the avatar color at the given size", () => {
		const html = render(h(Face, { name: "Paz", size: "lg" }));
		expect(html).toContain("size-12");
		expect(html).toContain("bg-avatar-4");
		expect(html).toContain(">PA<");
	});
});

describe("FaceStack", () => {
	it("puts the payer first and keeps the rest in order", () => {
		expect(orderFaces(people, "paz").map((p) => p.id)).toEqual([
			"paz",
			"me",
			"lucia",
			"martin",
			"juan",
		]);
	});

	it("folds everyone past max - 1 into +N", () => {
		const { shown, rest } = splitFaces(people, 4);
		expect(shown).toHaveLength(3);
		expect(rest.map((p) => p.id)).toEqual(["paz", "juan"]);
		expect(splitFaces(people.slice(0, 4), 4).rest).toHaveLength(0);
	});

	it("names everyone for screen readers, the viewer as You", () => {
		const html = render(h(FaceStack, { people: people.slice(0, 3) }));
		expect(html).toContain('role="img"');
		expect(html).toContain(
			'aria-label="You, Lucía Fernández, and Martín Alvarez"',
		);
	});

	it("rings the payer in accent when someone else paid", () => {
		const html = render(
			h(FaceStack, { people: people.slice(0, 3), payerId: "lucia" }),
		);
		expect(html.match(/ring-ds-accent/g)).toHaveLength(1);
		const self = render(
			h(FaceStack, { people: people.slice(0, 3), payerId: "me" }),
		);
		expect(self).not.toContain("ring-ds-accent");
	});

	it("overlaps, spreads on hover and ends with +N", () => {
		const html = render(h(FaceStack, { people, max: 4 }));
		expect(html).toContain("-ml-1");
		expect(html).toContain("can-hover:group-hover/faces:ml-1");
		expect(html).toContain(">+2<");
	});

	it("reads as names in the Names setting", () => {
		expect(
			render(h(FaceStack, { people: people.slice(1, 3), names: true })),
		).toContain("Lucía Fernández and Martín Alvarez");
		expect(render(h(FaceStack, { people, names: true }))).toContain(
			"You, Lucía Fernández and 3 more",
		);
	});

	it("draws nothing for nobody", () => {
		expect(render(h(FaceStack, { people: [] }))).toBe("");
	});
});
