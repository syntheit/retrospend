import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
	/**
	 * The action picks one of several choices (Change category, Move to
	 * project): the menu opens them as a submenu with their identity lead,
	 * and the handler gets the chosen id. Shown only when the page passes
	 * choices for it. Never a row letter or a swipe (there is no choice).
	 */
	pick?: true;
};

/** One choice of a pick action: its id, its name and its identity lead. */
export type ActionChoice = {
	id: string;
	label: string;
	/** A bare category glyph, a face, a project cover (R25). */
	lead?: ReactNode;
};
export type ActionChoices = Partial<Record<string, readonly ActionChoice[]>>;

export type ActionHandler<T> = (target: T, choice?: string) => unknown;
export type ActionHandlers<T> = Partial<Record<string, ActionHandler<T>>>;

export type MenuEntry<T extends ActionTarget> =
	| { kind: "item"; action: ActionDef<T>; run: () => unknown }
	| { kind: "separator"; key: string };

function available<T extends ActionTarget>(
	defs: readonly ActionDef<T>[],
	target: T,
	handlers: ActionHandlers<T>,
	choices?: ActionChoices,
) {
	return defs.filter(
		(a) =>
			handlers[a.id] &&
			(a.when ? a.when(target) : true) &&
			(!a.pick || (choices?.[a.id]?.length ?? 0) > 0),
	);
}

/** Actions that run at once on a letter or a swipe: never a pick. */
const direct = <T extends ActionTarget>(a: ActionDef<T>) => !a.pick;

/** The menu for one target: available actions, a separator between groups. */
export function menuEntries<T extends ActionTarget>(
	defs: readonly ActionDef<T>[],
	target: T,
	handlers: ActionHandlers<T>,
	choices?: ActionChoices,
): MenuEntry<T>[] {
	const out: MenuEntry<T>[] = [];
	let group: number | null = null;
	for (const action of available(defs, target, handlers, choices)) {
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
		(a) => direct(a) && swipeSide(a, target) === side,
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
		available(defs, target, handlers).find(
			(a) => direct(a) && a.kbd === letter,
		) ?? null
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
		if (a.pick && (a.kbd || a.swipe || a.danger))
			problems.push(
				`${entity}.${a.id}: a pick has no letter, swipe or confirm`,
			);
	}
	return problems;
}
