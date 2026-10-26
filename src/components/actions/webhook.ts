import {
	Pencil,
	Power,
	PowerOff,
	RefreshCw,
	ScrollText,
	Send,
	Trash2,
} from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A webhook of Settings > Developer; `enabled` decides Turn off or Turn on. */
export type WebhookTarget = ActionTarget & { enabled: boolean };

export const WEBHOOK_ACTIONS: readonly ActionDef<WebhookTarget>[] = [
	{ id: "edit", icon: Pencil, group: 0 },
	{ id: "test", icon: Send, group: 0 },
	{ id: "deliveries", icon: ScrollText, group: 0 },
	{ id: "turnOff", icon: PowerOff, group: 1, when: (w) => w.enabled },
	{ id: "turnOn", icon: Power, group: 1, when: (w) => !w.enabled },
	// The old secret cannot come back: the handler opens a sheet that asks how
	// long it keeps working, and says what rotating changes, before it does.
	{
		id: "rotateSecret",
		icon: RefreshCw,
		group: 1,
		danger: true,
		safety: "handler",
	},
	{ id: "delete", icon: Trash2, group: 2, danger: true },
];
