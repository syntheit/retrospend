import { Archive, Banknote, Link, Pin, Plus } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

export type ProjectTarget = ActionTarget & {
	/** A solo project has nobody to settle with. */
	solo: boolean;
};

export const PROJECT_ACTIONS: readonly ActionDef<ProjectTarget>[] = [
	{ id: "addExpense", icon: Plus, group: 0, swipe: "lead" },
	{ id: "pin", icon: Pin, group: 0 },
	{ id: "share", icon: Link, group: 0 },
	{ id: "settleAll", icon: Banknote, group: 0, when: (p) => !p.solo },
	{ id: "archive", icon: Archive, group: 1, swipe: "trail" },
];
