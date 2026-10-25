import {
	hostOf,
	MONTH_START_DAYS,
	type NotificationPreference,
	preferenceOf,
	withChannel,
} from "./source";

const prefs: NotificationPreference[] = [
	{ type: "EXPENSE_SPLIT", inApp: true, email: false, digestMode: false },
	{ type: "PAYMENT_REMINDER", inApp: true, email: true, digestMode: true },
];

describe("withChannel", () => {
	it("switches one channel of one type and keeps the rest", () => {
		const next = withChannel(prefs, "EXPENSE_SPLIT", "email", true);
		expect(next[0]).toEqual({
			type: "EXPENSE_SPLIT",
			inApp: true,
			email: true,
			digestMode: false,
		});
		expect(next[1]).toBe(prefs[1]);
		// The input is not changed.
		expect(prefs[0]?.email).toBe(false);
	});

	it("does not invent a type the server did not list", () => {
		expect(withChannel(prefs, "PERIOD_CLOSED", "inApp", false)).toEqual(prefs);
	});
});

describe("preferenceOf", () => {
	it("finds a type, or null", () => {
		expect(preferenceOf(prefs, "PAYMENT_REMINDER")?.digestMode).toBe(true);
		expect(preferenceOf(prefs, "PERIOD_CLOSED")).toBeNull();
	});
});

describe("hostOf", () => {
	it("shows the host, port included, without the scheme", () => {
		expect(hostOf("https://retrospend.app")).toBe("retrospend.app");
		expect(hostOf("http://192.168.1.5:3000/api")).toBe("192.168.1.5:3000");
		expect(hostOf("not a url")).toBe("not a url");
	});
});

describe("month start days", () => {
	it("are 1 to 28, as the server allows", () => {
		expect(MONTH_START_DAYS[0]).toBe(1);
		expect(MONTH_START_DAYS.at(-1)).toBe(28);
		expect(MONTH_START_DAYS).toHaveLength(28);
	});
});
