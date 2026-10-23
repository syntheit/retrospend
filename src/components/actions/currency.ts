import { Calculator, Copy, ExternalLink, Star, StarOff } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A currency on the Currencies page; `id` is its code. */
export type CurrencyTarget = ActionTarget & {
	favorite: boolean;
	/** False when the server has no rate for it yet. */
	hasRate: boolean;
	crypto: boolean;
};

export const CURRENCY_ACTIONS: readonly ActionDef<CurrencyTarget>[] = [
	{ id: "convert", icon: Calculator, group: 0 },
	{ id: "favorite", icon: Star, group: 0, when: (c) => !c.favorite },
	{ id: "unfavorite", icon: StarOff, group: 0, when: (c) => c.favorite },
	{ id: "copy", icon: Copy, group: 0, when: (c) => c.hasRate },
	{ id: "history", icon: ExternalLink, group: 1, when: (c) => !c.crypto },
];
