import {
	ArrowLeftRight,
	CreditCard,
	FlaskConical,
	HandCoins,
	Pencil,
	Receipt,
	Target,
} from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/**
 * A budget envelope (budget.html `Kit.actions.envelope`): the ⋯ menu,
 * right-click, long press and the phone swipe all read this list. `over`
 * is the server's status, so Cover shows only on an overspent envelope.
 */
export type EnvelopeTarget = ActionTarget & {
	over?: boolean;
	/** A bill that follows a liability (SPEC §5.11): Pay down a debt shows. */
	debt?: boolean;
};

export const ENVELOPE_ACTIONS: readonly ActionDef<EnvelopeTarget>[] = [
	{ id: "move", icon: ArrowLeftRight, kbd: "M", group: 0, swipe: "lead" },
	{
		id: "cover",
		icon: HandCoins,
		group: 0,
		when: (e) => e.over === true,
	},
	{
		id: "payDebt",
		icon: CreditCard,
		group: 0,
		when: (e) => e.debt === true,
	},
	{ id: "target", icon: Target, kbd: "T", group: 0, swipe: "trail" },
	{ id: "activity", icon: Receipt, group: 0 },
	{ id: "edit", icon: Pencil, group: 1 },
	{ id: "whatIf", icon: FlaskConical, group: 1 },
];
