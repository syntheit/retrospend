import { describe, expect, it, vi } from "vitest";
import { ACTIONS } from "./registry";
import { type ActionDef, type ActionTarget, menuEntries } from "./types";

describe("context menu sweep", () => {
	it("a destructive action never comes before a safe one", () => {
		for (const [entity, defs] of Object.entries(ACTIONS)) {
			const list = defs as readonly ActionDef<ActionTarget>[];
			const lastSafe = Math.max(...list.map((a, i) => (a.danger ? -1 : i)));
			const firstDanger = list.findIndex((a) => a.danger);
			if (firstDanger >= 0)
				expect(firstDanger, `${entity} danger order`).toBeGreaterThan(lastSafe);
		}
	});

	it("a notification offers Open, and Mark as read only while unread", () => {
		const handlers = { open: vi.fn(), markRead: vi.fn() };
		const of = (unread: boolean) =>
			menuEntries(
				ACTIONS.notification,
				{ id: "n1", name: "Budget", unread },
				handlers,
			).map((e) => (e.kind === "item" ? e.action.id : "|"));
		expect(of(true)).toEqual(["open", "markRead"]);
		expect(of(false)).toEqual(["open"]);
	});

	it("every swept entity has a registry", () => {
		for (const e of [
			"expense",
			"person",
			"project",
			"account",
			"envelope",
			"recurring",
			"currency",
			"category",
			"paymentMethod",
			"notification",
			"needsYou",
		])
			expect(Object.keys(ACTIONS), e).toContain(e);
	});
});
