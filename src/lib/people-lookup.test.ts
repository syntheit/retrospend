import { describe, expect, it } from "vitest";
import { buildPeopleLookup, findPerson } from "./people-lookup";

describe("buildPeopleLookup", () => {
	const lookup = buildPeopleLookup([
		{ participantType: "user", participantId: "u1", avatarUrl: "/a.png" },
		{ participantType: "shadow", participantId: "s1", avatarUrl: null },
		{ participantType: "user", participantId: "u2", avatarUrl: "/b.png" },
	]);

	it("keeps two people with the same name apart", () => {
		expect(findPerson(lookup, "user", "u1")).toEqual({
			avatarUrl: "/a.png",
			href: "/people/user/u1",
		});
		expect(findPerson(lookup, "user", "u2")).toEqual({
			avatarUrl: "/b.png",
			href: "/people/user/u2",
		});
	});

	it("separates participant types that share an id", () => {
		const mixed = buildPeopleLookup([
			{ participantType: "user", participantId: "x", avatarUrl: "/u.png" },
			{ participantType: "shadow", participantId: "x", avatarUrl: null },
		]);
		expect(findPerson(mixed, "shadow", "x")?.href).toBe("/people/shadow/x");
		expect(findPerson(mixed, "user", "x")?.avatarUrl).toBe("/u.png");
	});

	it("returns nothing for unknown or missing identities", () => {
		expect(findPerson(lookup, "guest", "u1")).toBeUndefined();
		expect(findPerson(lookup, undefined, "u1")).toBeUndefined();
		expect(findPerson(lookup, "user", undefined)).toBeUndefined();
	});
});
