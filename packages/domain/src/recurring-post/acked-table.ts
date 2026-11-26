/**
 * Which row the version in a server answer names, for one phone write. A
 * confirm or skip answers with the template's version (`templateUpdatedAt`),
 * even though a confirm also books an expense whose own version the answer
 * does not carry; every other write answers with the row it wrote.
 *
 * The one owner of that rule: the outbox stamps a chained entry's `before` row
 * with it, and the device engine's overlay sets an acked entry's version with
 * it. Both read the entry's changed tables, so they cannot disagree.
 */
export type AckedTable = "expenses" | "recurringTemplates";

export function ackedTableOf(
	changes: readonly { readonly table: string }[],
): AckedTable {
	return changes.some((c) => c.table === "recurringTemplates")
		? "recurringTemplates"
		: "expenses";
}
