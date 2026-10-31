import {
	bodyOf,
	canSetDates,
	datesBody,
	datesChanged,
	datesMeaning,
	datesOutOfOrder,
} from "./memberDates";
import type { ProjectMember } from "./source";

const member = (patch: Partial<ProjectMember> = {}): ProjectMember => ({
	id: "user:u2",
	name: "Ben",
	imageUrl: null,
	participantType: "user",
	participantId: "u2",
	isMe: false,
	role: "CONTRIBUTOR",
	onRetrospend: true,
	joinedOn: "2026-10-01",
	leftOn: null,
	withMe: [],
	...patch,
});

describe("member dates", () => {
	it("has nothing to save until a date changes", () => {
		const m = member();
		expect(datesChanged(m, { joinedOn: "2026-10-01", leftOn: null })).toBe(
			false,
		);
		expect(datesBody("p1", m, { joinedOn: "2026-10-01", leftOn: null })).toBe(
			null,
		);
	});

	it("sends both dates, so the old pair restores them exactly", () => {
		const m = member();
		expect(
			datesBody("p1", m, { joinedOn: "2026-10-01", leftOn: "2026-10-20" }),
		).toEqual({
			id: "p1",
			type: "user",
			personId: "u2",
			joinedOn: "2026-10-01",
			leftOn: "2026-10-20",
		});
		expect(bodyOf("p1", m, { joinedOn: "2026-10-01", leftOn: null })).toEqual({
			id: "p1",
			type: "user",
			personId: "u2",
			joinedOn: "2026-10-01",
			leftOn: null,
		});
	});

	it("clears a date with null", () => {
		expect(
			datesBody("p1", member(), { joinedOn: null, leftOn: null })?.joinedOn,
		).toBeNull();
	});

	it("refuses a leave day on or before the join day", () => {
		expect(
			datesOutOfOrder({ joinedOn: "2026-10-05", leftOn: "2026-10-05" }),
		).toBe(true);
		expect(
			datesOutOfOrder({ joinedOn: "2026-10-05", leftOn: "2026-10-04" }),
		).toBe(true);
		expect(
			datesOutOfOrder({ joinedOn: "2026-10-05", leftOn: "2026-10-06" }),
		).toBe(false);
		expect(datesOutOfOrder({ joinedOn: null, leftOn: "2026-10-06" })).toBe(
			false,
		);
		expect(
			datesBody("p1", member(), {
				joinedOn: "2026-10-05",
				leftOn: "2026-10-04",
			}),
		).toBeNull();
	});

	it("lets an Editor open everyone but an Owner", () => {
		expect(canSetDates("ORGANIZER", { role: "ORGANIZER" })).toBe(true);
		expect(canSetDates("EDITOR", { role: "ORGANIZER" })).toBe(false);
		expect(canSetDates("EDITOR", { role: "CONTRIBUTOR" })).toBe(true);
		expect(canSetDates("CONTRIBUTOR", { role: "VIEWER" })).toBe(false);
		expect(canSetDates(null, { role: "VIEWER" })).toBe(false);
	});

	it("says what the dates mean", () => {
		expect(datesMeaning({ joinedOn: null, leftOn: "2026-10-20" })).toBe(
			"leaves",
		);
		expect(datesMeaning({ joinedOn: "2026-10-01", leftOn: null })).toBe(
			"joins",
		);
		expect(datesMeaning({ joinedOn: null, leftOn: null })).toBe("always");
	});
});
