import { membersToAdd } from "./addMember";

const person = (type: string, id: string) => ({ person: { type, id } });
const member = (type: string, id: string, leftOn: string | null = null) => ({
	participantType: type,
	participantId: id,
	leftOn,
});

describe("membersToAdd", () => {
	it("leaves out the people already in the project", () => {
		const out = membersToAdd(
			[person("user", "a"), person("shadow", "b"), person("guest", "c")],
			[member("user", "a"), member("shadow", "b")],
		);
		expect(out).toEqual([person("guest", "c")]);
	});

	it("offers someone who left again", () => {
		expect(
			membersToAdd([person("user", "a")], [member("user", "a", "2026-09-01")]),
		).toEqual([person("user", "a")]);
	});

	it("tells a user from a person added by name with the same id", () => {
		expect(
			membersToAdd([person("shadow", "a")], [member("user", "a")]),
		).toEqual([person("shadow", "a")]);
	});
});
