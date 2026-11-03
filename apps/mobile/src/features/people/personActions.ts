import type { ActionDef } from "@/ui/actionRegistry";

/**
 * What can be done to a person, in one place: the row's long-press menu and
 * the person page (its three buttons, then its overflow) read this order.
 */
export type PersonActionId =
	| "settle"
	| "remind"
	| "expense"
	| "export-history"
	| "share-statement";

export const PERSON_ACTIONS: Record<
	PersonActionId,
	ActionDef<PersonActionId>
> = {
	settle: { id: "settle" },
	remind: { id: "remind" },
	expense: { id: "expense" },
	"export-history": { id: "export-history" },
	"share-statement": { id: "share-statement" },
};

/**
 * The actions for one person. Settle up needs something shared, Remind needs
 * money owed to you, Expense needs the composer; the two exports are always
 * there.
 */
export function personActionsOf(facts: {
	nothingShared: boolean;
	owesYou: boolean;
	canAdd: boolean;
}): PersonActionId[] {
	return [
		...(facts.nothingShared ? [] : (["settle"] as const)),
		...(facts.owesYou ? (["remind"] as const) : []),
		...(facts.canAdd ? (["expense"] as const) : []),
		"export-history",
		"share-statement",
	];
}
