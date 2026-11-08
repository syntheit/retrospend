/**
 * Which rows hang off a parent row. Undoing the creation of a parent deletes
 * it, and undoing a cascaded delete brings it back; either is only safe when
 * no child outside the token is attached to it now, or that child would be
 * orphaned (or attach to a parent it was never written against).
 */
import type { RowChange } from "./changes";
import type { TableName, Writer } from "./port";

interface Link {
	readonly parent: TableName;
	readonly child: TableName;
	/** The parent id a child row points at. */
	readonly parentId: (row: never) => string | null;
}

const LINKS: readonly Link[] = [
	{
		parent: "expenses",
		child: "shares",
		parentId: (r: { expenseId: string }) => r.expenseId,
	},
	{
		parent: "accounts",
		child: "legs",
		parentId: (r: { accountId: string | null }) => r.accountId,
	},
	{
		parent: "accounts",
		child: "snapshots",
		parentId: (r: { accountId: string }) => r.accountId,
	},
	{
		parent: "accounts",
		child: "rateSwitches",
		parentId: (r: { accountId: string }) => r.accountId,
	},
];

/**
 * Child rows that exist now, belong to a parent the changes create or delete,
 * and are not themselves part of the changes: the rows an undo would orphan.
 */
export function strayChildren(
	w: Writer,
	changes: readonly RowChange[],
): { table: TableName; id: string }[] {
	const inToken = new Set(changes.map((c) => `${c.table}\u0000${c.id}`));
	const stray: { table: TableName; id: string }[] = [];
	for (const link of LINKS) {
		const parents = new Set(
			changes
				.filter(
					(c) =>
						c.table === link.parent &&
						(c.before === null) !== (c.after === null),
				)
				.map((c) => c.id),
		);
		if (parents.size === 0) continue;
		for (const row of w.list(link.child)) {
			const owner = link.parentId(row as never);
			if (
				owner !== null &&
				parents.has(owner) &&
				!inToken.has(`${link.child}\u0000${row.id}`)
			)
				stray.push({ table: link.child, id: row.id });
		}
	}
	return stray;
}
