import type { LucideIcon } from "lucide-react";

/**
 * One action registry per entity (R8). An entity file lists what can be done
 * to it; the ⋯ menu, right-click, long press, swipe and row keys all read the
 * same list through the functions below. The registry holds no behavior: the
 * page passes a handler per action id (its mutation), and an action without a
 * handler is not shown, so nothing pretends to work.
 */

export type SwipeSide = "lead" | "trail";

/** Every entity target carries the name its confirm title uses. */
export type ActionTarget = { id: string; name: string };

export type ActionDef<T extends ActionTarget> = {
	/** Also the i18n key: entityActions.<entity>.<id>.label */
	id: string;
	icon: LucideIcon;
	/** Menu hint and row shortcut: a single uppercase letter. */
	kbd?: string;
	/**
	 * Destructive. Always confirms with a named button
	 * (entityActions.<entity>.<id>.confirmTitle and .confirmButton).
	 */
	danger?: boolean;
	/**
	 * How a destructive action is kept safe. "confirm" (the default): the
	 * menu asks first with a named button. "undo": it runs at once and its
	 * toast offers Undo (a removed row comes back, GUIDELINE §11). "handler":
	 * the handler opens its own confirm step, one that holds a choice (move
	 * a category's expenses before deleting it).
	 */
	safety?: "confirm" | "undo" | "handler";
	/** Which phone swipe side shows it, if any (each swipe has this menu twin). */
	swipe?: SwipeSide | ((target: T) => SwipeSide | null);
	/** Shown only when true for this target (ownership, lock, state). */
	when?: (target: T) => boolean;
	/** Separators go between groups. */
	group: number;
};

export type ActionHandler<T> = (target: T) => unknown;
export type ActionHandlers<T> = Partial<Record<string, ActionHandler<T>>>;

export type MenuEntry<T extends ActionTarget> =
	| { kind: "item"; action: ActionDef<T>; run: () => unknown }
	| { kind: "separator"; key: string };

function available<T extends ActionTarget>(
	defs: readonly ActionDef<T>[],
	target: T,
	handlers: ActionHandlers<T>,
) {
	return defs.filter((a) => handlers[a.id] && (a.when ? a.when(target) : true));
}

/** The menu for one target: available actions, a separator between groups. */
export function menuEntries<T extends ActionTarget>(
	defs: readonly ActionDef<T>[],
	target: T,
	handlers: ActionHandlers<T>,
): MenuEntry<T>[] {
	const out: MenuEntry<T>[] = [];
	let group: number | null = null;
	for (const action of available(defs, target, handlers)) {
		if (group !== null && action.group !== group)
			out.push({ kind: "separator", key: `sep-${action.group}` });
		group = action.group;
		const handler = handlers[action.id] as ActionHandler<T>;
		out.push({ kind: "item", action, run: () => handler(target) });
	}
	return out;
}

function swipeSide<T extends ActionTarget>(
	a: ActionDef<T>,
	target: T,
): SwipeSide | null {
	return typeof a.swipe === "function" ? a.swipe(target) : (a.swipe ?? null);
}

/** The actions on one swipe side. Every one of them is also in the menu. */
export function swipeEntries<T extends ActionTarget>(
	defs: readonly ActionDef<T>[],
	target: T,
	handlers: ActionHandlers<T>,
	side: SwipeSide,
): ActionDef<T>[] {
	return available(defs, target, handlers).filter(
		(a) => swipeSide(a, target) === side,
	);
}

type KeyLike = {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
};

/**
 * Row letters apply only to a key on the row itself: not one a child already
 * handled, not one from a field in the row, and not one that bubbled through
 * React from a portaled child (a menu or sheet opened from the row).
 */
export function isRowKey(e: {
	defaultPrevented: boolean;
	target: unknown;
	currentTarget: unknown;
}): boolean {
	return !e.defaultPrevented && e.target === e.currentTarget;
}

/** A focused row runs the action whose menu hint matches the letter typed. */
export function actionForKey<T extends ActionTarget>(
	defs: readonly ActionDef<T>[],
	target: T,
	handlers: ActionHandlers<T>,
	e: KeyLike,
): ActionDef<T> | null {
	if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return null;
	const letter = e.key.toUpperCase();
	return (
		available(defs, target, handlers).find((a) => a.kbd === letter) ?? null
	);
}

/** Registry shape check: ids unique, hints unique single letters, danger never swipes lead. */
export function registryProblems<T extends ActionTarget>(
	entity: string,
	defs: readonly ActionDef<T>[],
): string[] {
	const problems: string[] = [];
	const ids = new Set<string>();
	const kbds = new Set<string>();
	for (const a of defs) {
		if (ids.has(a.id)) problems.push(`${entity}.${a.id}: duplicate id`);
		ids.add(a.id);
		if (a.kbd) {
			if (!/^[A-Z]$/.test(a.kbd)) problems.push(`${entity}.${a.id}: kbd`);
			if (kbds.has(a.kbd)) problems.push(`${entity}.${a.id}: kbd taken`);
			kbds.add(a.kbd);
		}
		if (a.danger && a.swipe === "lead")
			problems.push(`${entity}.${a.id}: destructive on the lead swipe`);
	}
	return problems;
}
