import { Coins, FileUp, Mail, Plus } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A setup prompt for a new account (Needs you `setup.*`). */
export type SetupTarget = ActionTarget;

export const SETUP_ACTIONS: readonly ActionDef<SetupTarget>[] = [
	{ id: "addExpense", icon: Plus, group: 0 },
	{ id: "chooseCurrency", icon: Coins, group: 0 },
	{ id: "resendEmail", icon: Mail, group: 0 },
	{ id: "import", icon: FileUp, group: 0 },
];
