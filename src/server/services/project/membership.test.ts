import { describe, expect, it } from "vitest";
import {
	assertValidMembership,
	fromIsoDate,
	InvalidMembershipDatesError,
	isIsoDate,
	isMemberOn,
	joinedAfter,
	toIsoDate,
} from "./membership";

describe("isMemberOn (RC-11)", () => {
	const juli = { joinedOn: "2026-11-01", leftOn: null };
	const juan = { joinedOn: null, leftOn: "2026-05-01" };

	it("leaves out someone who joins after the day", () => {
		// Juli joins Depto Palermo on Nov 1; an expense dated Oct 21 is not hers.
		expect(isMemberOn(juli, "2026-10-21")).toBe(false);
	});

	it("includes someone from the day they join", () => {
		expect(isMemberOn(juli, "2026-11-01")).toBe(true);
		expect(isMemberOn(juli, "2027-01-15")).toBe(true);
	});

	it("drops someone on the day they leave, not before", () => {
		expect(isMemberOn(juan, "2026-04-30")).toBe(true);
		expect(isMemberOn(juan, "2026-05-01")).toBe(false);
	});

	it("treats missing dates as from the start and still a member", () => {
		expect(isMemberOn({ joinedOn: null, leftOn: null }, "1999-01-01")).toBe(
			true,
		);
	});
});

describe("joinedAfter", () => {
	it("is true only before a known join date", () => {
		expect(joinedAfter({ joinedOn: "2026-11-01" }, "2026-10-31")).toBe(true);
		expect(joinedAfter({ joinedOn: "2026-11-01" }, "2026-11-01")).toBe(false);
		expect(joinedAfter({ joinedOn: null }, "2000-01-01")).toBe(false);
	});
});

describe("assertValidMembership", () => {
	it("refuses a leave date on or before the join date", () => {
		expect(() =>
			assertValidMembership({ joinedOn: "2026-11-01", leftOn: "2026-11-01" }),
		).toThrow(InvalidMembershipDatesError);
		expect(() =>
			assertValidMembership({ joinedOn: "2026-11-01", leftOn: "2026-11-02" }),
		).not.toThrow();
		expect(() =>
			assertValidMembership({ joinedOn: null, leftOn: "2026-11-02" }),
		).not.toThrow();
	});
});

describe("ISO days", () => {
	it("accepts real calendar days only", () => {
		expect(isIsoDate("2026-02-28")).toBe(true);
		expect(isIsoDate("2026-02-30")).toBe(false);
		expect(isIsoDate("2026-2-3")).toBe(false);
		expect(() => fromIsoDate("2026-13-01")).toThrow(
			InvalidMembershipDatesError,
		);
	});

	it("round-trips through a DATE column value", () => {
		expect(toIsoDate(fromIsoDate("2026-11-01"))).toBe("2026-11-01");
	});
});
