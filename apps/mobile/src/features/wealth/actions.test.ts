import { actionsOf, swipesOf } from "./actions";

describe("account actions", () => {
	it("lets an open account update, edit, close or be deleted", () => {
		expect(actionsOf({ closedAt: null })).toEqual([
			"update",
			"edit",
			"close",
			"delete",
		]);
		expect(swipesOf({ closedAt: null })).toEqual({
			leading: "update",
			trailing: "close",
		});
	});

	it("lets a closed account reopen or be deleted", () => {
		const closed = { closedAt: "2026-01-01T00:00:00.000Z" };
		expect(actionsOf(closed)).toEqual(["reopen", "delete"]);
		expect(swipesOf(closed)).toEqual({
			leading: "reopen",
			trailing: "delete",
		});
	});

	it("keeps every swipe in the menu too", () => {
		for (const account of [
			{ closedAt: null },
			{ closedAt: "2026-01-01T00:00:00.000Z" },
		]) {
			const menu = actionsOf(account);
			const swipes = swipesOf(account);
			expect(menu).toContain(swipes.leading);
			expect(menu).toContain(swipes.trailing);
		}
	});
});
