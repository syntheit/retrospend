import { describe, expect, it, vi } from "vitest";
import en from "../../../packages/i18n/messages/en/entityActions.json";
import type { ExpenseTarget } from "./expense";
import { ACTIONS } from "./registry";
import { restingOffset, isSwipe, settleSwipe, swipeOffset } from "./swipe";
import {
	type ActionDef,
	type ActionHandlers,
	type ActionTarget,
	actionForKey,
	menuEntries,
	registryProblems,
	swipeEntries,
} from "./types";

const expense = (over: Partial<ExpenseTarget> = {}): ExpenseTarget => ({
	id: "e1",
	name: "Café del Sur",
	mine: true,
	locked: false,
	reviewed: true,
	shared: false,
	...over,
});

/** A handler for every expense action, so only `when` decides. */
const all = Object.fromEntries(
	ACTIONS.expense.map((a) => [a.id, vi.fn()]),
) as ActionHandlers<ExpenseTarget>;

const ids = (entries: ReturnType<typeof menuEntries<ExpenseTarget>>) =>
	entries.map((e) => (e.kind === "item" ? e.action.id : "|"));

describe("action registry", () => {
	it("every entity list is well formed", () => {
		for (const [entity, defs] of Object.entries(ACTIONS))
			expect(
				registryProblems(entity, defs as readonly ActionDef<ActionTarget>[]),
				entity,
			).toEqual([]);
	});

	it("every action has a label, and every destructive one a named confirm", () => {
		const copy = en as Record<string, Record<string, Record<string, string>>>;
		for (const [entity, defs] of Object.entries(ACTIONS))
			for (const a of defs) {
				const m = copy[entity]?.[a.id];
				expect(m?.label, `${entity}.${a.id}.label`).toBeTruthy();
				if (a.danger) {
					expect(m?.confirmTitle).toContain("{name}");
					expect(m?.confirmButton, `${entity}.${a.id}`).toBeTruthy();
					// A named button, never a bare OK or the same word as the title verb alone.
					expect(m?.confirmButton?.split(" ").length).toBeGreaterThan(1);
				}
			}
	});
});

describe("menu entries", () => {
	it("your own unsettled expense: edit, split, category, project, delete after a separator", () => {
		expect(ids(menuEntries(ACTIONS.expense, expense(), all))).toEqual([
			"open",
			"edit",
			"split",
			"category",
			"project",
			"duplicate",
			"|",
			"delete",
		]);
	});

	it("someone else's expense: Ask to fix instead of Edit, no Delete", () => {
		const out = ids(
			menuEntries(ACTIONS.expense, expense({ mine: false }), all),
		);
		expect(out).toContain("askFix");
		expect(out).not.toContain("edit");
		expect(out).not.toContain("delete");
		expect(out.at(-1)).not.toBe("|");
	});

	it("a settled expense offers Correct, not Edit or Delete", () => {
		const out = ids(
			menuEntries(ACTIONS.expense, expense({ locked: true }), all),
		);
		expect(out).toContain("correct");
		expect(out).not.toContain("edit");
		expect(out).not.toContain("delete");
	});

	it("an action without a handler is not shown (nothing pretends to work)", () => {
		const only = { open: vi.fn(), delete: vi.fn() };
		expect(ids(menuEntries(ACTIONS.expense, expense(), only))).toEqual([
			"open",
			"|",
			"delete",
		]);
		expect(menuEntries(ACTIONS.expense, expense(), {})).toEqual([]);
	});

	it("run calls the page's handler with the target", () => {
		const open = vi.fn();
		const e = expense();
		const [first] = menuEntries(ACTIONS.expense, e, { open });
		if (first?.kind === "item") first.run();
		expect(open).toHaveBeenCalledWith(e);
	});
});

describe("swipe twins", () => {
	it("every swipe action is also in the menu", () => {
		for (const t of [
			expense(),
			expense({ reviewed: false }),
			expense({ mine: false }),
		]) {
			const menu = new Set(ids(menuEntries(ACTIONS.expense, t, all)));
			for (const side of ["lead", "trail"] as const)
				for (const a of swipeEntries(ACTIONS.expense, t, all, side))
					expect(menu.has(a.id), a.id).toBe(true);
		}
	});

	it("an unreviewed expense swipes Mark as reviewed; a reviewed one swipes Split", () => {
		const lead = (t: ExpenseTarget) =>
			swipeEntries(ACTIONS.expense, t, all, "lead").map((a) => a.id);
		expect(lead(expense({ reviewed: false }))).toEqual(["review"]);
		expect(lead(expense())).toEqual(["split"]);
		expect(
			swipeEntries(ACTIONS.expense, expense(), all, "trail").map((a) => a.id),
		).toEqual(["delete"]);
	});
});

describe("row keys", () => {
	it("the menu hint letter runs its action on a focused row", () => {
		expect(
			actionForKey(ACTIONS.expense, expense(), all, { key: "e" })?.id,
		).toBe("edit");
		expect(
			actionForKey(ACTIONS.expense, expense(), all, { key: "E" })?.id,
		).toBe("edit");
	});

	it("not with a modifier, not for a hidden action, not for other keys", () => {
		expect(
			actionForKey(ACTIONS.expense, expense(), all, {
				key: "e",
				metaKey: true,
			}),
		).toBeNull();
		expect(
			actionForKey(ACTIONS.expense, expense({ mine: false }), all, {
				key: "e",
			}),
		).toBeNull();
		expect(
			actionForKey(ACTIONS.expense, expense(), all, { key: "Enter" }),
		).toBeNull();
	});
});

describe("swipe geometry", () => {
	it("follows the finger but stops at the uncovered actions", () => {
		expect(swipeOffset(30, 80, 120)).toBe(30);
		expect(swipeOffset(200, 80, 120)).toBe(80);
		expect(swipeOffset(-300, 80, 120)).toBe(-120);
	});

	it("opens a side past half its width, else closes", () => {
		expect(settleSwipe(40, 80, 120)).toBe("lead");
		expect(settleSwipe(39, 80, 120)).toBe("closed");
		expect(settleSwipe(-60, 80, 120)).toBe("trail");
		expect(settleSwipe(50, 0, 120)).toBe("closed");
		expect(restingOffset("trail", 80, 120)).toBe(-120);
		expect(restingOffset("closed", 80, 120)).toBe(0);
	});

	it("a mostly vertical drag is a scroll, not a swipe", () => {
		expect(isSwipe(20, 5)).toBe(true);
		expect(isSwipe(20, 30)).toBe(false);
		expect(isSwipe(6, 0)).toBe(false);
	});
});
