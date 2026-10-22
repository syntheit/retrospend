import { Banknote, Bell, Plus, Send, User } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

export type PersonTarget = ActionTarget;

export const PERSON_ACTIONS: readonly ActionDef<PersonTarget>[] = [
	{ id: "settle", icon: Banknote, kbd: "S", group: 0, swipe: "lead" },
	{ id: "request", icon: Send, group: 0 },
	{ id: "remind", icon: Bell, group: 0, swipe: "trail" },
	{ id: "addExpense", icon: Plus, group: 0 },
	{ id: "profile", icon: User, group: 1 },
];
