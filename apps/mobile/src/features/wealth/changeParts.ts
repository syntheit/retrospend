import type { NetWorth } from "./source";

/** The parts of a change, in the order the web lists them. */
const ORDER = [
	"income",
	"spending",
	"exchange",
	"notLogged",
	"revaluation",
	"opened",
	"closed",
] as const;

export type Change = NonNullable<NetWorth["change"]>;

/** The parts that moved; a part that is zero stays out. */
export function movedParts(change: Change): (typeof ORDER)[number][] {
	return ORDER.filter((part) => change.parts[part].minor !== 0);
}
