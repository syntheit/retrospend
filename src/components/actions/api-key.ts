import { Trash2 } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

export type ApiKeyTarget = ActionTarget;

export const API_KEY_ACTIONS: readonly ActionDef<ApiKeyTarget>[] = [
	{ id: "revoke", icon: Trash2, group: 0, danger: true },
];
