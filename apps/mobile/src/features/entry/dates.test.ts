import { dayOfPicker, pickerDate, shiftDay } from "./dates";

describe("the day a native picker holds", () => {
	it("round-trips every day of a leap year on both clocks", () => {
		for (let i = 0; i < 366; i++) {
			const day = shiftDay("2028-01-01", i);
			expect(dayOfPicker(pickerDate(day, "local"), "local")).toBe(day);
			expect(dayOfPicker(pickerDate(day, "utc"), "utc")).toBe(day);
		}
	});

	it("keeps the day in local time at noon, far from either midnight", () => {
		const date = pickerDate("2026-10-25", "local");
		expect(date.getHours()).toBe(12);
		expect(date.getDate()).toBe(25);
	});

	it("builds the Material picker's day at UTC midnight", () => {
		expect(pickerDate("2026-10-25", "utc").toISOString()).toBe(
			"2026-10-25T00:00:00.000Z",
		);
	});

	it("reads a picked instant on the clock the picker counts on", () => {
		// 23:30 on the 24th in Buenos Aires is already the 25th in UTC.
		const lateLocal = new Date("2026-10-25T02:30:00Z");
		expect(dayOfPicker(lateLocal, "utc")).toBe("2026-10-25");
	});

	it("shifts across month and year ends", () => {
		expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
		expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
		expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
	});
});
