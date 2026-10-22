import { Archive, History, Pencil, PencilLine } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

export type AccountTarget = ActionTarget;

export const ACCOUNT_ACTIONS: readonly ActionDef<AccountTarget>[] = [
	{ id: "updateBalance", icon: PencilLine, group: 0, swipe: "lead" },
	{ id: "history", icon: History, group: 0 },
	{ id: "edit", icon: Pencil, group: 0 },
	{ id: "archive", icon: Archive, group: 1, swipe: "trail" },
];
