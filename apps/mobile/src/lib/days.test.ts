import {
	dayDate,
	dayKey,
	daysBetween,
	monthDays,
	shiftDay,
	utcDayKey,
} from "./days";

describe("days", () => {
	it("shifts across month and year ends", () => {
		expect(shiftDay("2026-10-01", -1)).toBe("2026-09-30");
		expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
		expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
		expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
		expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
	});

	it("counts whole days between two days", () => {
		expect(daysBetween("2026-10-01", "2026-10-25")).toBe(24);
		expect(daysBetween("2026-10-25", "2026-10-25")).toBe(0);
		expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
	});

	it("keeps a day at local noon and reads it back as the same day", () => {
		const date = dayDate("2026-10-25");
		expect(date.getHours()).toBe(12);
		expect(dayKey(date)).toBe("2026-10-25");
	});

	it("names the phone's day by its own clock, not the UTC one", () => {
		// 23:30 local on the 25th is the phone's 25th whatever the UTC day is.
		expect(dayKey(new Date(2026, 9, 25, 23, 30))).toBe("2026-10-25");
		expect(dayKey(new Date(2026, 9, 25, 0, 30))).toBe("2026-10-25");
		expect(utcDayKey(new Date("2026-10-25T02:30:00Z"))).toBe("2026-10-25");
	});

	it("gives the first and last day of the phone's month", () => {
		expect(monthDays(new Date(2028, 1, 10))).toEqual({
			from: "2028-02-01",
			to: "2028-02-29",
		});
	});
});
