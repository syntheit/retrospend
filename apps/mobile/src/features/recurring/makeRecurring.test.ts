import type { ActivityItem } from "@/features/activity/source";
import {
	canRepeat,
	nextMonthly,
	nextOnDay,
	templateBody,
} from "./makeRecurring";

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
	id: "a",
	source: "personal",
	entityId: "ea",
	kind: "expense",
	title: "Streamly",
	category: null,
	amount: { minor: 1000, currency: "ARS" },
	sortKey: 1000,
	project: null,
	date: "2026-10-21",
	mine: true,
	locked: false,
	canEdit: true,
	...over,
});

describe("nextMonthly", () => {
	it("moves the month and keeps the day", () => {
		expect(nextMonthly("2026-10-21")).toBe("2026-11-21");
		expect(nextMonthly("2026-12-05")).toBe("2027-01-05");
	});

	it("lands on the last day of a shorter month", () => {
		expect(nextMonthly("2026-01-31")).toBe("2026-02-28");
		expect(nextMonthly("2028-01-31")).toBe("2028-02-29");
	});
});

describe("canRepeat", () => {
	it("is your own expense only", () => {
		expect(canRepeat(item())).toBe(true);
		expect(canRepeat(item({ source: "shared" }))).toBe(false);
		expect(canRepeat(item({ kind: "income" }))).toBe(false);
		expect(canRepeat(item({ mine: false }))).toBe(false);
	});
});

describe("nextOnDay", () => {
	it("stays in this month while the day is still ahead", () => {
		expect(nextOnDay("2026-10-10", 15)).toBe("2026-10-15");
		expect(nextOnDay("2026-10-15", 15)).toBe("2026-10-15");
	});
	it("moves to next month once the day has passed", () => {
		expect(nextOnDay("2026-10-31", 15)).toBe("2026-11-15");
		expect(nextOnDay("2026-12-20", 5)).toBe("2027-01-05");
	});
	it("takes the last day of a short month", () => {
		expect(nextOnDay("2026-02-10", 31)).toBe("2026-02-28");
		expect(nextOnDay("2026-01-31", 30)).toBe("2026-02-28");
	});
});

describe("templateBody", () => {
	it("keeps the entry's day as the anchor when the next month is shorter", () => {
		const body = templateBody(item({ date: "2027-01-31" }));
		expect(body.nextDueDate).toBe("2027-02-28");
		expect(body.anchorDay).toBe(31);
	});
});

describe("nextOnDay with a short month", () => {
	it("clamps the first date, so the anchor has to travel separately", () => {
		expect(nextOnDay("2027-02-10", 31)).toBe("2027-02-28");
	});
});
