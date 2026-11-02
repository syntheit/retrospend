import {
	backupState,
	quotaChoices,
	quotaPercent,
	shiftMonth,
	sizeParts,
	uptimeParts,
} from "./serverRules";

describe("server and usage rules", () => {
	it("splits sizes into a number and a unit", () => {
		expect(sizeParts(0)).toEqual({ value: 0, unit: "B" });
		expect(sizeParts(1536)).toEqual({ value: 1.5, unit: "KB" });
		expect(sizeParts(5 * 1024 ** 3).unit).toBe("GB");
	});
	it("splits uptime", () => {
		expect(uptimeParts(90_061)).toEqual({ days: 1, hours: 1, minutes: 1 });
	});
	it("names the backup state", () => {
		expect(backupState({ available: false })).toBe("unavailable");
		expect(backupState({ available: true, running: true })).toBe("running");
		expect(backupState({ available: true })).toBe("neverRun");
		expect(
			backupState({ available: true, lastBackup: { success: false } }),
		).toBe("failed");
		expect(
			backupState({ available: true, lastBackup: { success: true } }),
		).toBe("healthy");
	});
	it("rounds quota shares and has none without a quota", () => {
		expect(quotaPercent(50, 200)).toBe(25);
		expect(quotaPercent(5, 0)).toBeNull();
	});
	it("keeps the server's own quota in the choices", () => {
		expect(quotaChoices(123)).toContain(123);
		expect(quotaChoices(0)[0]).toBe(0);
	});
	it("steps months across a year", () => {
		expect(shiftMonth("2026-01", -1)).toBe("2025-12");
		expect(shiftMonth("2026-12", 1)).toBe("2027-01");
	});
});
