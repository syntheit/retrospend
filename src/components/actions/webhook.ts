import { Power, PowerOff, RefreshCw, ScrollText, Send, Trash2 } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A webhook of Settings > Developer; `enabled` decides Turn off or Turn on. */
export type WebhookTarget = ActionTarget & { enabled: boolean };

export const WEBHOOK_ACTIONS: readonly ActionDef<WebhookTarget>[] = [
	{ id: "test", icon: Send, group: 0 },
	{ id: "deliveries", icon: ScrollText, group: 0 },
	{ id: "turnOff", icon: PowerOff, group: 1, when: (w) => w.enabled },
	{ id: "turnOn", icon: Power, group: 1, when: (w) => !w.enabled },
	// The old secret stops working at once and cannot come back: confirm first.
	{ id: "rotateSecret", icon: RefreshCw, group: 1, danger: true },
	{ id: "delete", icon: Trash2, group: 2, danger: true },
];
