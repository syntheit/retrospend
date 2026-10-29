import { figureKey, figureLines } from "./figures";

const ars = (minor: number) => ({ minor, currency: "ARS" });

const change = (
	id: string,
	before: ReturnType<typeof ars> | null,
	after: ReturnType<typeof ars> | null,
) => ({ id, currency: "ARS", before, after });

describe("figure lines", () => {
	it("keeps every figure that moved, in the server's order, not only the pool", () => {
		const lines = figureLines({
			changes: [
				change("budget.notPlannedYet", ars(100), ars(80)),
				change("budget.leftInLimits", ars(500), ars(520)),
				change("budget.holds", ars(900), ars(900)),
			],
			unchanged: [],
			unavailable: [],
		});
		expect(lines.changes.map((c) => c.id)).toEqual([
			"budget.notPlannedYet",
			"budget.leftInLimits",
			"budget.holds",
		]);
		expect(lines.changes[1]).toMatchObject({
			before: ars(500),
			after: ars(520),
		});
	});

	it("names what stays and what could not be read, once each", () => {
		const lines = figureLines({
			changes: [],
			unchanged: [
				{ id: "budget.leftToSpend" },
				{ id: "budget.leftToSpend" },
				{ id: "budget.holds" },
			],
			unavailable: [
				{ id: "netWorth", before: [ars(1)], after: null },
				{ id: "netWorth", before: [ars(1)], after: null },
			],
		});
		expect(lines.stays).toEqual(["budget.leftToSpend", "budget.holds"]);
		expect(lines.unavailable).toEqual(["netWorth"]);
	});

	it("a style-only figure that is null on both sides is not applicable, not unknown", () => {
		const lines = figureLines({
			changes: [],
			unchanged: [],
			unavailable: [
				{ id: "budget.leftInLimits", before: null, after: null },
				{ id: "budget.leftThisWeek", before: null, after: null },
				// The same figure with a real side is a real gap (a missing rate).
				{ id: "budget.leftInLimits", before: [ars(5)], after: null },
			],
		});
		expect(lines.unavailable).toEqual(["budget.leftInLimits"]);
	});

	it("a missing side stays null (said as Not available), never 0", () => {
		const lines = figureLines({
			changes: [change("netWorth", ars(10), null)],
			unchanged: [],
			unavailable: [],
		});
		expect(lines.changes[0]?.after).toBeNull();
	});

	it("leaves out what the sheet's own lines say, and percent lines", () => {
		const lines = figureLines(
			{
				changes: [
					change("envelope.left", ars(1), ars(2)),
					{ id: "share", currency: "%", before: null, after: null },
					change("budget.holds", ars(3), ars(4)),
				],
				unchanged: [{ id: "envelope.left" }],
				unavailable: [],
			},
			["envelope.left"],
		);
		expect(lines.changes.map((c) => c.id)).toEqual(["budget.holds"]);
		expect(lines.stays).toEqual([]);
	});

	it("turns a figure id into a message key", () => {
		expect(figureKey("budget.leftToSpend")).toBe("budget_leftToSpend");
		expect(figureKey("netWorth")).toBe("netWorth");
	});
});
