/**
 * Which row the version in a server answer names, for one phone write. A
 * confirm or skip answers with the template's version (`templateUpdatedAt`),
 * even though a confirm also books an expense whose own version the answer
 * does not carry. An account write answers with the account's version (a
 * number, held as text on the entry); a transfer moves accounts but does not
 * version them and answers with none, so it never names the accounts table.
 * Every other write answers with the row it wrote.
 *
 * The one owner of that rule: the outbox stamps a chained entry's `before` row
 * with it, and the device engine's overlay sets an acked entry's version with
 * it. Both read the entry's changed tables, so they cannot disagree.
 */
export type AckedTable = "expenses" | "recurringTemplates" | "accounts";

export function ackedTableOf(
	changes: readonly { readonly table: string }[],
): AckedTable {
	if (changes.some((c) => c.table === "recurringTemplates"))
		return "recurringTemplates";
	return changes.some((c) => c.table === "accounts") &&
		!changes.some((c) => c.table === "transfers")
		? "accounts"
		: "expenses";
}
