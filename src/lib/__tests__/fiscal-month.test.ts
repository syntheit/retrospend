import { describe, expect, it } from "vitest";
import {
	getFiscalMonthRange,
	getCurrentFiscalMonth,
	getFiscalMonthProgress,
} from "../fiscal-month";

describe("getFiscalMonthRange", () => {
	describe("startDay=1 (fast path)", () => {
		it("returns full calendar month from 1st to last day", () => {
			const { start, end } = getFiscalMonthRange(new Date(2024, 6, 15), 1);
			expect(start).toEqual(new Date(2024, 6, 1));
			expect(end).toEqual(new Date(2024, 6, 31, 23, 59, 59, 999));
		});

		it("start is at 00:00:00.000", () => {
			const { start } = getFiscalMonthRange(new Date(2024, 6, 1), 1);
			expect(start.getHours()).toBe(0);
			expect(start.getMinutes()).toBe(0);
			expect(start.getSeconds()).toBe(0);
			expect(start.getMilliseconds()).toBe(0);
		});

		it("end is at 23:59:59.999", () => {
			const { end } = getFiscalMonthRange(new Date(2024, 6, 1), 1);
			expect(end.getHours()).toBe(23);
			expect(end.getMinutes()).toBe(59);
			expect(end.getSeconds()).toBe(59);
			expect(end.getMilliseconds()).toBe(999);
		});

		it("handles December correctly (month 11)", () => {
			const { start, end } = getFiscalMonthRange(new Date(2024, 11, 5), 1);
			expect(start).toEqual(new Date(2024, 11, 1));
			expect(end).toEqual(new Date(2024, 11, 31, 23, 59, 59, 999));
		});
	});

	describe("startDay=15", () => {
		it("July with startDay=15: range is Jul 15 to Aug 14 (no DST)", () => {
			const { start, end } = getFiscalMonthRange(new Date(2024, 6, 1), 15);
			expect(start).toEqual(new Date(2024, 6, 15));
			expect(end).toEqual(new Date(2024, 7, 14, 23, 59, 59, 999));
		});

		it("start is at midnight", () => {
			const { start } = getFiscalMonthRange(new Date(2024, 6, 1), 15);
			expect(start.getHours()).toBe(0);
			expect(start.getMinutes()).toBe(0);
			expect(start.getSeconds()).toBe(0);
			expect(start.getMilliseconds()).toBe(0);
		});

		it("end is at 23:59:59.999", () => {
			const { end } = getFiscalMonthRange(new Date(2024, 6, 1), 15);
			expect(end.getHours()).toBe(23);
			expect(end.getMinutes()).toBe(59);
			expect(end.getSeconds()).toBe(59);
			expect(end.getMilliseconds()).toBe(999);
		});

		it("December range wraps to January of next year", () => {
			const { start, end } = getFiscalMonthRange(new Date(2024, 11, 1), 15);
			expect(start).toEqual(new Date(2024, 11, 15));
			expect(end).toEqual(new Date(2025, 0, 14, 23, 59, 59, 999));
		});
	});

	describe("short month edge cases", () => {
		it("startDay=28, February non-leap: range is Feb 28 to Mar 27", () => {
			// 2023 is not a leap year
			const { start, end } = getFiscalMonthRange(new Date(2023, 1, 1), 28);
			expect(start).toEqual(new Date(2023, 1, 28));
			expect(end).toEqual(new Date(2023, 2, 27, 23, 59, 59, 999));
		});

		it("startDay=31 on a 30-day month: JS Date overflow wraps to next month", () => {
			// April has 30 days; new Date(2024, 3, 31) overflows to May 1
			const { start } = getFiscalMonthRange(new Date(2024, 3, 1), 31);
			// April + 31 = May 1 (JS overflow behavior)
			expect(start).toEqual(new Date(2024, 4, 1));
		});
	});
});

describe("getCurrentFiscalMonth", () => {
	describe("startDay=1", () => {
		it("always returns 1st of current month", () => {
			const result = getCurrentFiscalMonth(new Date(2024, 6, 15), 1);
			expect(result).toEqual(new Date(2024, 6, 1));
		});

		it("returns 1st of current month even on the 1st", () => {
			const result = getCurrentFiscalMonth(new Date(2024, 6, 1), 1);
			expect(result).toEqual(new Date(2024, 6, 1));
		});
	});

	describe("startDay=15", () => {
		it("day >= startDay: returns current month fiscal start", () => {
			const result = getCurrentFiscalMonth(new Date(2024, 6, 20), 15);
			expect(result).toEqual(new Date(2024, 6, 1));
		});

		it("day === startDay: returns current month", () => {
			const result = getCurrentFiscalMonth(new Date(2024, 6, 15), 15);
			expect(result).toEqual(new Date(2024, 6, 1));
		});

		it("day < startDay: returns previous month fiscal start", () => {
			const result = getCurrentFiscalMonth(new Date(2024, 6, 5), 15);
			expect(result).toEqual(new Date(2024, 5, 1));
		});
	});

	describe("January wrap-around", () => {
		it("January with startDay=15, date=Jan 5: wraps to December of previous year", () => {
			const result = getCurrentFiscalMonth(new Date(2024, 0, 5), 15);
			expect(result).toEqual(new Date(2023, 11, 1));
		});
	});
});

describe("getFiscalMonthProgress", () => {
	// Use July 2024 (summer, no DST transitions) for reliable day counting
	describe("current period - July 2024 (DST-safe)", () => {
		it(
			// BUG: daysInPeriod formula uses Math.round(~30.999) + 1 = 32 instead of 31.
			// Math.floor + 1 would be correct. Correct value for July is 31.
			"calculates correct daysInPeriod for July (startDay=1)",
			() => {
				const now = new Date(2024, 6, 15);
				const month = new Date(2024, 6, 1);
				const { daysInPeriod } = getFiscalMonthProgress(now, month, 1);
				expect(daysInPeriod).toBe(31);
			},
		);

		it("calculates currentDay correctly mid-month (DST-safe July)", () => {
			const now = new Date(2024, 6, 15);
			const month = new Date(2024, 6, 1);
			const { currentDay } = getFiscalMonthProgress(now, month, 1);
			expect(currentDay).toBe(15);
		});

		it(
			// BUG: daysRemaining = max(0, daysInPeriod - currentDay + 1). If daysInPeriod is
			// incorrectly 32 (bug above), then daysRemaining = 32 - 15 + 1 = 18, not 17.
			// Correct: 31 - 15 + 1 = 17.
			"calculates daysRemaining correctly (Jul 15, 31-day period)",
			() => {
				const now = new Date(2024, 6, 15);
				const month = new Date(2024, 6, 1);
				const { daysRemaining } = getFiscalMonthProgress(now, month, 1);
				expect(daysRemaining).toBe(17);
			},
		);

		it("isCurrentPeriod is true when now is in range", () => {
			const now = new Date(2024, 6, 15);
			const month = new Date(2024, 6, 1);
			const { isCurrentPeriod } = getFiscalMonthProgress(now, month, 1);
			expect(isCurrentPeriod).toBe(true);
		});

		it(
			// BUG: same daysInPeriod off-by-one bug. Jul 15 to Aug 14 = 31 days, not 32.
			"calculates 31-day fiscal period (startDay=15, July)",
			() => {
				const now = new Date(2024, 6, 20);
				const month = new Date(2024, 6, 1);
				const { daysInPeriod } = getFiscalMonthProgress(now, month, 15);
				expect(daysInPeriod).toBe(31);
			},
		);
	});

	describe("past period", () => {
		it("currentDay equals daysInPeriod for past period", () => {
			const now = new Date(2024, 7, 1); // August, past July period
			const month = new Date(2024, 6, 1);
			const { currentDay, daysInPeriod } = getFiscalMonthProgress(
				now,
				month,
				1,
			);
			expect(currentDay).toBe(daysInPeriod);
		});

		it("daysRemaining is 0 for past period", () => {
			const now = new Date(2024, 7, 1);
			const month = new Date(2024, 6, 1);
			const { daysRemaining } = getFiscalMonthProgress(now, month, 1);
			expect(daysRemaining).toBe(0);
		});

		it("isCurrentPeriod is false for past period", () => {
			const now = new Date(2024, 7, 1);
			const month = new Date(2024, 6, 1);
			const { isCurrentPeriod } = getFiscalMonthProgress(now, month, 1);
			expect(isCurrentPeriod).toBe(false);
		});
	});

	describe("future period", () => {
		it("isCurrentPeriod is false for future period", () => {
			const now = new Date(2024, 5, 1); // June, viewing July
			const month = new Date(2024, 6, 1);
			const { isCurrentPeriod } = getFiscalMonthProgress(now, month, 1);
			expect(isCurrentPeriod).toBe(false);
		});

		it("daysRemaining is 0 for future period", () => {
			const now = new Date(2024, 5, 1);
			const month = new Date(2024, 6, 1);
			const { daysRemaining } = getFiscalMonthProgress(now, month, 1);
			expect(daysRemaining).toBe(0);
		});
	});
});
