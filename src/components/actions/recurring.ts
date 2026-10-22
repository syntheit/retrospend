import { Check, Pause, Pencil, Play, SkipForward, Trash2 } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

export type RecurringTarget = ActionTarget & { paused: boolean };

export const RECURRING_ACTIONS: readonly ActionDef<RecurringTarget>[] = [
	{ id: "confirm", icon: Check, group: 0, swipe: "lead" },
	{ id: "editAmount", icon: Pencil, group: 0 },
	{ id: "pause", icon: Pause, group: 0, when: (r) => !r.paused },
	{ id: "resume", icon: Play, group: 0, when: (r) => r.paused },
	{ id: "skip", icon: SkipForward, group: 1, swipe: "trail" },
	{ id: "delete", icon: Trash2, group: 1, danger: true },
];
