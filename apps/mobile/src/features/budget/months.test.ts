import {
	addMonths,
	canStep,
	lastMonth,
	monthChoices,
	monthDate,
	monthInfo,
	monthKind,
	monthParts,
} from "./months";

describe("month keys", () => {
	it("splits and steps across a year edge", () => {
		expect(monthParts(202610)).toEqual({ year: 2026, month: 10 });
		expect(addMonths(202612, 1)).toBe(202701);
		expect(addMonths(202601, -1)).toBe(202512);
		expect(addMonths(202610, 0)).toBe(202610);
		expect(addMonths(202610, -13)).toBe(202509);
	});

	it("gives a date inside the month", () => {
		expect(monthDate(202602).toISOString()).toBe("2026-02-15T00:00:00.000Z");
	});

	const bounds = { first: 202608, open: 202610 };

	it("lets the person plan one month ahead and read back to the first", () => {
		expect(lastMonth(bounds)).toBe(202611);
		expect(canStep(202610, 1, bounds)).toBe(true);
		expect(canStep(202611, 1, bounds)).toBe(false);
		expect(canStep(202608, -1, bounds)).toBe(false);
		expect(canStep(202609, -1, bounds)).toBe(true);
	});

	it("lists months newest first and stops at the book's first", () => {
		expect(monthChoices(bounds)).toEqual([202611, 202610, 202609, 202608]);
		expect(monthChoices({ first: 200001, open: 202610 }, 3)).toEqual([
			202611, 202610, 202609,
		]);
	});

	it("places the month on screen from the server's state", () => {
		expect(monthInfo({ key: 202610, state: "OPEN" }, 202608, null)).toEqual({
			kind: "open",
			bounds: { first: 202608, open: 202610 },
		});
		expect(monthInfo({ key: 202611, state: "NEXT" }, 202608, 202610)).toEqual({
			kind: "next",
			bounds: { first: 202608, open: 202610 },
		});
		expect(monthInfo({ key: 202609, state: "CLOSED" }, 202608, 202610)).toEqual({
			kind: "closed",
			bounds: { first: 202608, open: 202610 },
		});
		// A closed month seen before the open one: the open month is the next one.
		expect(monthInfo({ key: 202609, state: "CLOSED" }, 202608, null).bounds.open).toBe(
			202610,
		);
	});

	it("tells closed, open and next apart", () => {
		expect(monthKind(202609, bounds)).toBe("closed");
		expect(monthKind(202610, bounds)).toBe("open");
		expect(monthKind(202611, bounds)).toBe("next");
	});
});
