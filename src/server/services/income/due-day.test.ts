import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dueAnchorDay, nextDueAfter, nextDueDay } from "./due-day";

const TOKYO = "Asia/Tokyo";
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const iso = (date: Date) => date.toISOString();

// A process zone that is neither UTC nor the user's, so reading the wrong one shows.
let processZone: string | undefined;
beforeEach(() => {
	processZone = process.env.TZ;
	process.env.TZ = "America/Los_Angeles";
});
afterEach(() => {
	if (processZone === undefined) delete process.env.TZ;
	else process.env.TZ = processZone;
});

describe("nextDueDay", () => {
	it("steps UTC midnight days: Jan 31 monthly is Feb 28, never a local day", () => {
		// Jan 31 00:00Z is Jan 30 16:00 in Los Angeles; a local step gives Feb 28 08:00Z.
		expect(iso(nextDueDay(new Date("2027-01-31T00:00:00Z"), "MONTHLY"))).toBe(
			"2027-02-28T00:00:00.000Z",
		);
	});

	it("anchors on an explicit day and on the UTC day when none is given", () => {
		const jan31 = new Date("2027-01-31T00:00:00Z");
		expect(iso(nextDueDay(jan31, "MONTHLY", 15))).toBe(
			"2027-02-15T00:00:00.000Z",
		);
		expect(
			iso(nextDueDay(new Date("2027-02-28T00:00:00Z"), "MONTHLY", 31)),
		).toBe("2027-03-31T00:00:00.000Z");
		expect(iso(nextDueDay(jan31, "QUARTERLY"))).toBe(
			"2027-04-30T00:00:00.000Z",
		);
	});
});

describe("nextDueAfter", () => {
	const income = {
		direction: "IN",
		frequency: "MONTHLY",
		anchorDay: 31,
	} as const;
	const expense = {
		direction: "OUT",
		frequency: "MONTHLY",
		anchorDay: 31,
	} as const;

	it("income steps UTC days whatever the user's zone is", () => {
		// In Buenos Aires Jan 31 00:00Z is Jan 30, whose step would be 03:00Z.
		expect(
			iso(nextDueAfter(income, new Date("2027-01-31T00:00:00Z"), BUENOS_AIRES)),
		).toBe("2027-02-28T00:00:00.000Z");
	});

	it("an expense steps the user's local days", () => {
		// Jan 31 00:00 in Tokyo is Jan 30 15:00Z; the next is Feb 28 00:00 Tokyo.
		expect(
			iso(nextDueAfter(expense, new Date("2027-01-30T15:00:00Z"), TOKYO)),
		).toBe("2027-02-27T15:00:00.000Z");
	});
});

describe("dueAnchorDay", () => {
	const due = (
		direction: "IN" | "OUT",
		anchorDay: number | null,
		at: string,
	) => ({
		direction,
		frequency: "MONTHLY" as const,
		anchorDay,
		nextDueDate: new Date(at),
	});

	it("keeps a stored anchor of either direction", () => {
		expect(dueAnchorDay(due("IN", 15, "2027-01-31T00:00:00Z"), TOKYO)).toBe(15);
		expect(dueAnchorDay(due("OUT", 15, "2027-01-31T00:00:00Z"), TOKYO)).toBe(
			15,
		);
	});

	it("income without an anchor reads the UTC day", () => {
		// Jan 31 00:00Z is already Jan 31 09:00 in Tokyo but Jan 30 in Buenos Aires.
		expect(
			dueAnchorDay(due("IN", null, "2027-01-31T00:00:00Z"), BUENOS_AIRES),
		).toBe(31);
	});

	it("an expense without an anchor reads the day in the user's zone", () => {
		// Jan 30 15:00Z is Jan 31 00:00 in Tokyo.
		expect(dueAnchorDay(due("OUT", null, "2027-01-30T15:00:00Z"), TOKYO)).toBe(
			31,
		);
	});
});
