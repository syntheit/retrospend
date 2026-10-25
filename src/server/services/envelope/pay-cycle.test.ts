import { describe, expect, it } from "vitest";
import { nextPay } from "./pay-cycle";

describe("nextPay", () => {
	it("is the anchor while it is today or later", () => {
		expect(nextPay("MONTHLY", "2026-11-05", "2026-10-25")).toBe("2026-11-05");
		expect(nextPay("WEEKLY", "2026-10-25", "2026-10-25")).toBe("2026-10-25");
	});

	it("monthly keeps the anchor's day", () => {
		expect(nextPay("MONTHLY", "2026-08-05", "2026-10-25")).toBe("2026-11-05");
		expect(nextPay("MONTHLY", "2026-08-05", "2026-10-05")).toBe("2026-10-05");
		expect(nextPay("MONTHLY", "2026-08-05", "2026-10-06")).toBe("2026-11-05");
		expect(nextPay("MONTHLY", "2025-12-20", "2026-01-21")).toBe("2026-02-20");
	});

	it("monthly on the 31st uses a short month's last day", () => {
		expect(nextPay("MONTHLY", "2026-01-31", "2026-02-10")).toBe("2026-02-28");
		expect(nextPay("MONTHLY", "2026-01-31", "2026-03-01")).toBe("2026-03-31");
	});

	it("every two weeks and weekly step from the anchor", () => {
		// Fri Oct 2, every 14 days: Oct 16, Oct 30
		expect(nextPay("EVERY_TWO_WEEKS", "2026-10-02", "2026-10-25")).toBe(
			"2026-10-30",
		);
		expect(nextPay("EVERY_TWO_WEEKS", "2026-10-02", "2026-10-30")).toBe(
			"2026-10-30",
		);
		// Fri Oct 2, every 7 days: Oct 9, 16, 23, 30
		expect(nextPay("WEEKLY", "2026-10-02", "2026-10-24")).toBe("2026-10-30");
	});

	it("is null when pay varies or nothing was asked", () => {
		expect(nextPay("VARIES", "2026-11-05", "2026-10-25")).toBeNull();
		expect(nextPay("MONTHLY", null, "2026-10-25")).toBeNull();
		expect(nextPay(null, null, "2026-10-25")).toBeNull();
	});
});
