import { ArrowRight, Clock } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A Needs you item: its ⋯ menu, long press and iPhone swipe (home mockup). */
export type NeedsYouTarget = ActionTarget;

export const NEEDS_YOU_ACTIONS: readonly ActionDef<NeedsYouTarget>[] = [
	{ id: "open", icon: ArrowRight, group: 0, swipe: "lead" },
	// Hides the item until tomorrow; its toast offers Undo.
	{ id: "later", icon: Clock, group: 0, swipe: "trail" },
];
