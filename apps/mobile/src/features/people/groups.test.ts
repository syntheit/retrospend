import {
	approxSides,
	chipKeeps,
	isApproximate,
	matchesName,
	pinsOf,
	sectionsOf,
	sideOf,
	sortPeople,
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

describe("sortPeople", () => {
	const seen = (name: string, date: string | null): PersonSummary => ({
		...person(name, "owed"),
		lastShared: date ? { title: "x", date, project: null } : null,
	});
	const list = [
		seen("Paz", "2026-10-01"),
		seen("Ana", null),
		seen("Lucía", "2026-10-20"),
	];
	const names = (sort: Parameters<typeof sortPeople>[1]) =>
		sortPeople(list, sort).map((p) => p.person.name);

	it("keeps the server's order for Balance", () => {
		expect(names("balance")).toEqual(["Paz", "Ana", "Lucía"]);
	});
	it("puts the newest shared expense first for Recent, nobody last", () => {
		expect(names("recent")).toEqual(["Lucía", "Paz", "Ana"]);
	});
	it("goes A to Z for Name", () => {
		expect(names("name")).toEqual(["Ana", "Lucía", "Paz"]);
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

describe("approxSides", () => {
	it("looks at the parts owed to you for Owed to you and the others for You owe", () => {
		const withParts = (parts: { minor: number; currency: string }[]) => ({
			...person("X", "owed"),
			parts: parts.map((amount) => ({ amount, home: null, rate: null })),
		});
		const people = [
			withParts([
				{ minor: 500, currency: "ARS" },
				{ minor: -200, currency: "BRL" },
			]),
		];
		expect(approxSides(people, "ARS")).toEqual({
			owedToYou: false,
			youOwe: true,
		});
		expect(approxSides([], "ARS")).toEqual({ owedToYou: false, youOwe: false });
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

describe("pinsOf", () => {
	const seg = (key: string, direction: "owed" | "owe", share: number) => ({
		key,
		direction,
		share,
		amount: { minor: 100, currency: "ARS" },
	});
	it("pins the biggest owed segments, at most three of 11% or more, then the first you owe", () => {
		const segments = [
			seg("a", "owed", 4000),
			seg("b", "owed", 2000),
			seg("c", "owed", 1500),
			seg("d", "owed", 1200),
			seg("e", "owed", 300),
			seg("f", "owe", 900),
			seg("g", "owe", 500),
		];
		expect(pinsOf(segments).map((s) => s.key)).toEqual(["a", "b", "c", "f"]);
	});
	it("pins nobody for a bar of small slivers", () => {
		expect(pinsOf([seg("a", "owed", 500)])).toEqual([]);
	});
});
