import { type ActionDef, menuOf } from "@/ui/actionRegistry";
import type { MenuItem } from "@/ui/types";
import type { PaymentMethod } from "./source";

/**
 * What can be done to a payment method, in one place: the row's long-press
 * menu and the method's sheet (its fields, Make primary, then the quiet
 * Remove) read this order, Remove last.
 */
export type MethodActionId = "edit" | "prefer" | "remove";

export const METHOD_ACTIONS: Record<
	MethodActionId,
	ActionDef<MethodActionId>
> = {
	edit: { id: "edit", icon: "Pencil" },
	prefer: { id: "prefer" },
	remove: { id: "remove", icon: "Trash2", destructive: true },
};

/** Make primary only for a method that is not the first already. */
export function methodActionsOf(method: Pick<PaymentMethod, "rank">) {
	return [
		"edit",
		...(method.rank === 1 ? [] : (["prefer"] as const)),
		"remove",
	] as MethodActionId[];
}

/** The row's menu: Edit, Make primary, Remove. */
export function methodMenu(
	method: PaymentMethod,
	words: Record<MethodActionId, string>,
	run: Record<MethodActionId, () => void>,
): MenuItem[] {
	return menuOf(methodActionsOf(method), METHOD_ACTIONS, words, run);
}
