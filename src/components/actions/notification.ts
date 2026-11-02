import { ArrowRight, Check } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A notification in the bell's feed; `unread` hides Mark as read once read. */
export type NotificationTarget = ActionTarget & { unread: boolean };

export const NOTIFICATION_ACTIONS: readonly ActionDef<NotificationTarget>[] = [
	{ id: "open", icon: ArrowRight, group: 0 },
	{ id: "markRead", icon: Check, group: 0, when: (t) => t.unread },
];
