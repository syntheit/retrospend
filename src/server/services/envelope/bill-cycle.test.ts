import { describe, expect, it } from "vitest";
import { type BillCycleInput, billCycle } from "./bill-cycle";

/** Whole currency units to minor (2 decimals). */
const m = (n: number) => Math.round(n * 100);

describe("billCycle (D26 grace, S8, S9 paid early)", () => {
	const base: BillCycleInput = {
		amount: m(38_000),
		nextDue: "2026-11-10",
		repeatMonths: 1,
		monthStart: "2026-11-01",
		today: "2026-11-02",
		linkedToTemplate: true,
		paidThisCycle: 0,
	};

	it.each([
		{
			name: "S8 due on the 10th of this month",
			o: {},
			due: "2026-11-10",
			done: false,
		},
		{
			name: "an unlinked bill dated last month moves to this month",
			o: { nextDue: "2026-10-10", linkedToTemplate: false },
			due: "2026-11-10",
			done: false,
		},
		{
			name: "D26 a linked bill not posted stays open 7 days after its date",
			o: { nextDue: "2026-10-30", today: "2026-11-06" },
			due: "2026-10-30",
			done: false,
		},
		{
			name: "D26 after the 7-day grace it moves on",
			o: { nextDue: "2026-10-30", today: "2026-11-07" },
			due: "2026-11-30",
			done: false,
		},
		{
			name: "S9 paid early to 90% advances one repeat",
			o: {
				amount: m(1_200),
				nextDue: "2027-05-15",
				repeatMonths: 12,
				monthStart: "2027-04-01",
				today: "2027-04-20",
				linkedToTemplate: false,
				paidThisCycle: m(1_080),
			},
			due: "2028-05-15",
			done: false,
		},
		{
			name: "S9 paid 89% does not advance",
			o: {
				amount: m(1_200),
				nextDue: "2027-05-15",
				repeatMonths: 12,
				monthStart: "2027-04-01",
				today: "2027-04-20",
				linkedToTemplate: false,
				paidThisCycle: m(1_068),
			},
			due: "2027-05-15",
			done: false,
		},
		{
			name: "a one-off bill paid in full is done",
			o: { repeatMonths: null, paidThisCycle: m(38_000) },
			due: "2026-11-10",
			done: true,
		},
		{
			name: "repeats keep the anchor day (Jan 31 bill in February)",
			o: {
				nextDue: "2026-01-31",
				monthStart: "2026-02-01",
				today: "2026-02-10",
				linkedToTemplate: false,
			},
			due: "2026-02-28",
			done: false,
		},
	])("$name", ({ o, due, done }) => {
		expect(billCycle({ ...base, ...o })).toEqual({ due, done });
	});

	it.each([0, -1, 1.5])("rejects a repeat of %s months", (repeatMonths) => {
		expect(() => billCycle({ ...base, repeatMonths })).toThrow(RangeError);
	});
});
