import { daysBetween, groupsOf, isDue } from "./groups";
import type { RecurringItem } from "./source";

function item(over: Partial<RecurringItem>): RecurringItem {
	return {
		id: "r",
		title: "Rent",
		category: { id: null, name: null, icon: null, tone: 1 },
		frequency: "monthly",
		next: "2026-11-01",
		dueAt: "2026-11-01T12:00:00.000Z",
		nextAfter: "2026-12-01",
		state: "upcoming",
		paused: false,
		autoPay: false,
		direction: "out",
		amountMode: "fixed",
		amount: { minor: 100000, currency: "USD" },
		websiteUrl: null,
		paymentSource: null,
		updatedAt: "2026-10-01T00:00:00.000Z",
		...over,
	} as RecurringItem;
}

describe("daysBetween", () => {
	it("counts whole days, negative when earlier", () => {
		expect(daysBetween("2026-10-28", "2026-11-01")).toBe(4);
		expect(daysBetween("2026-10-28", "2026-10-25")).toBe(-3);
	});
});

describe("groupsOf", () => {
	const today = "2026-10-28";
	it("puts due and overdue first, then 30 days, later, then money in", () => {
		const groups = groupsOf(
			[
				item({ id: "a", next: "2026-10-20", state: "overdue" }),
				item({ id: "b", next: "2026-11-10" }),
				item({ id: "c", next: "2027-02-01" }),
				item({ id: "d", direction: "in", next: "2026-11-01" }),
				item({ id: "e", next: "2026-10-28", state: "due" }),
			],
			today,
		);
		expect(groups.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
			["due", ["a", "e"]],
			["next30", ["b"]],
			["later", ["c"]],
			["in", ["d"]],
		]);
	});

	it("keeps a paused overdue item out of Due now", () => {
		const paused = item({
			id: "p",
			state: "overdue",
			paused: true,
			next: "2026-10-01",
		});
		expect(isDue(paused)).toBe(false);
		expect(groupsOf([paused], today).map((g) => g.id)).toEqual(["next30"]);
	});

	it("leaves out empty groups", () => {
		expect(groupsOf([], today)).toEqual([]);
	});
});
