import {
	chipKeeps,
	isApproximate,
	matchesName,
	sectionsOf,
	sideOf,
} from "./groups";
import type { PersonSummary } from "./source";

function person(
	name: string,
	group: PersonSummary["group"],
	onRetrospend = true,
): PersonSummary {
	return {
		person: {
			key: `user:${name}`,
			type: "user",
			id: name,
			name,
			username: null,
			imageUrl: null,
			onRetrospend,
		},
		group,
		net: null,
		parts: [],
		pending: null,
		needsYou: 0,
		unseen: 0,
		lastShared: null,
	};
}

const people = [
	person("Martín", "owe"),
	person("Paz", "owed", false),
	person("Lucía", "owed"),
	person("Tomás", "settled"),
];

describe("sectionsOf", () => {
	it("orders groups owed, owe, pending, settled and keeps the server's order inside", () => {
		expect(
			sectionsOf(people, "all", "").map((s) => [
				s.group,
				s.people.map((p) => p.person.name),
			]),
		).toEqual([
			["owed", ["Paz", "Lucía"]],
			["owe", ["Martín"]],
			["settled", ["Tomás"]],
		]);
	});

	it("filters by chip and by name without caring for accents or case", () => {
		expect(
			sectionsOf(people, "youOwe", "").flatMap((s) => s.people).length,
		).toBe(1);
		expect(
			sectionsOf(people, "all", "LUCIA").flatMap((s) =>
				s.people.map((p) => p.person.name),
			),
		).toEqual(["Lucía"]);
		expect(chipKeeps("notOnRetrospend", people[1] as PersonSummary)).toBe(true);
		expect(matchesName(people[2] as PersonSummary, "ía")).toBe(true);
	});
});

describe("sideOf", () => {
	const ars = (minor: number) => ({ minor, currency: "ARS" });
	it("follows the home net, then the first part, then settled", () => {
		expect(sideOf(ars(100), [])).toBe("owesYou");
		expect(sideOf(ars(-100), [])).toBe("youOwe");
		expect(sideOf(null, [{ amount: ars(0) }, { amount: ars(-5) }])).toBe(
			"youOwe",
		);
		expect(sideOf(ars(0), [])).toBe("settled");
		expect(sideOf(null, [])).toBe("settled");
	});
});

describe("isApproximate", () => {
	it("is exact in one currency and an estimate with another", () => {
		const ars = { amount: { minor: 100, currency: "ARS" } };
		const brl = { amount: { minor: 100, currency: "BRL" } };
		expect(isApproximate([ars], "ARS")).toBe(false);
		expect(isApproximate([ars, brl], "ARS")).toBe(true);
	});
});
