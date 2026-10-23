import { ArrowDown, ArrowUp, Eye, Pencil, Star, Trash2 } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

export type PaymentMethodTarget = ActionTarget & {
	/** The first method is the primary one. */
	first: boolean;
	last: boolean;
	visibility: "PUBLIC" | "FRIENDS_ONLY" | "PAYMENT_ONLY";
};

export const PAYMENT_METHOD_ACTIONS: readonly ActionDef<PaymentMethodTarget>[] =
	[
		{ id: "edit", icon: Pencil, group: 0 },
		{ id: "makePrimary", icon: Star, group: 0, when: (m) => !m.first },
		{
			id: "showPublic",
			icon: Eye,
			group: 1,
			when: (m) => m.visibility !== "PUBLIC",
		},
		{
			id: "showContacts",
			icon: Eye,
			group: 1,
			when: (m) => m.visibility !== "FRIENDS_ONLY",
		},
		{
			id: "showSettlement",
			icon: Eye,
			group: 1,
			when: (m) => m.visibility !== "PAYMENT_ONLY",
		},
		{ id: "moveUp", icon: ArrowUp, group: 2, when: (m) => !m.first },
		{ id: "moveDown", icon: ArrowDown, group: 2, when: (m) => !m.last },
		// The row leaves at once and its toast brings it back.
		{ id: "remove", icon: Trash2, group: 3, danger: true, safety: "undo" },
	];
