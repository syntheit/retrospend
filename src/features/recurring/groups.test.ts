import { describe, expect, it } from "vitest";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import { groupsOf, matches } from "./groups";

const TODAY = "2026-10-21";
const item = (
	id: string,
	over: Partial<RecurringItemDTO>,
): RecurringItemDTO => ({
	id,
	title: id,
	category: { id: null, name: "Subscriptions", icon: null, tone: 8 },
	frequency: "monthly",
	next: TODAY,
	dueAt: "2026-10-21T03:00:00.000Z",
	nextAfter: "2026-11-21",
	state: "upcoming",
	paused: false,
	autoPay: false,
	direction: "out",
	amount: { minor: 100, currency: "ARS" },
	websiteUrl: null,
	...over,
});

describe("Recurring groups", () => {
	const items = [
		item("overdue", { next: "2026-10-19", state: "overdue" }),
		item("today", { state: "due" }),
		item("soon", { next: "2026-11-20" }),
		item("far", { next: "2026-11-21" }),
		item("pausedDue", { next: "2026-10-19", state: "overdue", paused: true }),
		item("salary", { direction: "in", next: "2026-11-01" }),
	];

	it("puts due ones first, then by days to the next date, then money in", () => {
		expect(
			groupsOf(items, TODAY).map((g) => [g.id, g.items.map((i) => i.id)]),
		).toEqual([
			["due", ["overdue", "today"]],
			// 30 days out is still "next 30 days"; a paused one never shows as due.
			["next30", ["soon", "pausedDue"]],
			["later", ["far"]],
			["in", ["salary"]],
		]);
	});

	it("drops empty groups", () => {
		expect(
			groupsOf([items[3] as RecurringItemDTO], TODAY).map((g) => g.id),
		).toEqual(["later"]);
	});

	it("filters by folded search and the chips", () => {
		const none = { autoPayOn: false, autoPayOff: false, foreign: false };
		const r = item("Café Martínez", {
			autoPay: true,
			amount: { minor: 1, currency: "USD" },
		});
		expect(matches(r, "cafe martinez", none, "ARS")).toBe(true);
		expect(matches(r, "subscriptions", none, "ARS")).toBe(true);
		expect(matches(r, "rent", none, "ARS")).toBe(false);
		expect(matches(r, "", { ...none, autoPayOff: true }, "ARS")).toBe(false);
		expect(
			matches(r, "", { ...none, autoPayOn: true, autoPayOff: true }, "ARS"),
		).toBe(true);
		expect(matches(r, "", { ...none, foreign: true }, "USD")).toBe(false);
	});
});
