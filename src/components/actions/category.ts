import { Eye, EyeOff, Palette, Trash2 } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

export type CategoryTarget = ActionTarget & {
	/** New expenses in it are left out of totals. */
	excluded: boolean;
};

export const CATEGORY_ACTIONS: readonly ActionDef<CategoryTarget>[] = [
	{ id: "edit", icon: Palette, group: 0 },
	{ id: "exclude", icon: EyeOff, group: 0, when: (c) => !c.excluded },
	{ id: "include", icon: Eye, group: 0, when: (c) => c.excluded },
	// The category manager asks, and offers to move its expenses first.
	{ id: "delete", icon: Trash2, group: 1, danger: true, safety: "handler" },
];
