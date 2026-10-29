import { type RowActionHandlers, rowActions } from "./rowActions";
import type { ActivityItem } from "./source";

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
	id: "a",
	source: "personal",
	entityId: "ea",
	kind: "expense",
	title: "Coffee",
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

const words = {
	select: "Select",
	edit: "Edit",
	categorize: "Categorize",
	delete: "Delete",
};
const none = () => {};
const on: RowActionHandlers = {
	select: none,
	edit: none,
	categorize: none,
	remove: none,
};

describe("rowActions", () => {
	it("gives your own expense every action, Select first and Delete last", () => {
		const actions = rowActions(item(), words, on, true);
		expect(actions.menu.map((m) => m.id)).toEqual([
			"select",
			"edit",
			"categorize",
			"delete",
		]);
		expect(actions.menu.at(-1)?.destructive).toBe(true);
		expect(actions.leading?.label).toBe("Edit");
		expect(actions.trailing?.tone).toBe("danger");
	});

	it("leaves Edit out when the add flow is not there", () => {
		const actions = rowActions(item(), words, on, false);
		expect(actions.menu.map((m) => m.id)).toEqual([
			"select",
			"categorize",
			"delete",
		]);
		expect(actions.leading).toBeUndefined();
	});

	it("lets a split you may change be edited but not deleted from the list", () => {
		const actions = rowActions(item({ source: "shared" }), words, on, true);
		expect(actions.menu.map((m) => m.id)).toEqual(["edit"]);
		expect(actions.trailing).toBeUndefined();
	});

	it("gives a payment and a locked expense nothing", () => {
		expect(
			rowActions(item({ source: "payment", kind: "payment" }), words, on, true)
				.menu,
		).toEqual([]);
		expect(rowActions(item({ locked: true }), words, on, true).menu).toEqual(
			[],
		);
	});
});
