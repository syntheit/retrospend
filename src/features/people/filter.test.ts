import { describe, expect, it } from "vitest";
import { groupPeople, matchesPerson, sortPeople } from "./filter";
import { NO_PEOPLE_FILTERS, type PersonSummary } from "./types";

const ars = (minor: number) => ({ minor, currency: "ARS" });

function person(
	name: string,
	group: PersonSummary["group"],
	net: number | null,
	o: { onRetrospend?: boolean; last?: string } = {},
): PersonSummary {
	return {
		person: {
			key: `user:${name}`,
			type: "user",
			id: name,
			name,
			username: name.toLowerCase(),
			imageUrl: null,
			onRetrospend: o.onRetrospend ?? true,
		},
		group,
		net: net === null ? null : ars(net),
		parts: [],
		pending: null,
		needsYou: 0,
		unseen: 0,
		lastShared: o.last ? { title: "x", date: o.last, project: null } : null,
	};
}

const LUCIA = person("Lucía", "owed", 300, { last: "2026-10-10" });
const PAZ = person("Paz", "owed", null, {
	onRetrospend: false,
	last: "2026-10-20",
});
const MARTIN = person("Martín", "owe", -900, { last: "2026-10-01" });
const JUAN = person("Juan", "settled", 0, { last: "2026-09-01" });
const NICO = person("Nico", "settled", 0, { last: "2026-10-05" });

describe("matchesPerson", () => {
	it("finds a name without its accent", () => {
		expect(matchesPerson(LUCIA, { ...NO_PEOPLE_FILTERS, query: "lucia" })).toBe(
			true,
		);
		expect(
			matchesPerson(MARTIN, { ...NO_PEOPLE_FILTERS, query: "lucia" }),
		).toBe(false);
	});
	it("applies the direction and Not on Retrospend chips", () => {
		expect(matchesPerson(MARTIN, { ...NO_PEOPLE_FILTERS, dir: "owed" })).toBe(
			false,
		);
		expect(
			matchesPerson(LUCIA, { ...NO_PEOPLE_FILTERS, notOnRetrospend: true }),
		).toBe(false);
		expect(
			matchesPerson(PAZ, { ...NO_PEOPLE_FILTERS, notOnRetrospend: true }),
		).toBe(true);
	});
});

describe("sortPeople", () => {
	it("by balance puts the biggest first and people without a net last", () => {
		expect(
			sortPeople([LUCIA, PAZ, MARTIN], "balance", "en").map(
				(p) => p.person.name,
			),
		).toEqual(["Martín", "Lucía", "Paz"]);
	});
	it("by recent puts the last shared first", () => {
		expect(
			sortPeople([LUCIA, PAZ, MARTIN], "recent", "en").map(
				(p) => p.person.name,
			),
		).toEqual(["Paz", "Lucía", "Martín"]);
	});
});

describe("groupPeople", () => {
	it("keeps each group in the sort, and Settled newest first", () => {
		const g = groupPeople([JUAN, LUCIA, NICO, PAZ, MARTIN], "name", "en");
		expect(g.owed.map((p) => p.person.name)).toEqual(["Lucía", "Paz"]);
		expect(g.owe.map((p) => p.person.name)).toEqual(["Martín"]);
		expect(g.settled.map((p) => p.person.name)).toEqual(["Nico", "Juan"]);
	});
});
