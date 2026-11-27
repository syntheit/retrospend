/**
 * Write parity for an account or transfer write: the rows of an acked entry
 * held to the rows a pull brought, by the columns the conformance suites hold
 * equal (wealth-columns.ts, the one owner). Same rules as the expense compare:
 * a row the ack's version does not name may have been written since, so it is
 * a skip, never a difference; nothing is re-booked and nothing is shown.
 *
 * Left out, and why:
 * - an account's balance and counted units: any leg moves them without moving
 *   the account's version, so a later write cannot be told from a difference;
 *   the legs carry the amounts and are compared.
 * - snapshots: the server names its own id and every later write of the day
 *   replaces the row, so there is no row to hold by id.
 * - a rate switch's `previousType`: the next switch repoints it.
 * - a leg's and a switch's `createdAt`: each side stamps the instant it wrote.
 * - the name and the note: the device keeps no text.
 */

import type { Reader } from "./port";
import { differingColumns } from "./wealth-columns";
import type { WealthChange, WealthTable } from "./wealth-rows";
import type { AckedWrite, WriteVerdict } from "./write-parity";

const NOT_COMPARED: Record<
	Exclude<WealthTable, "snapshots">,
	readonly string[]
> = {
	accounts: ["balance", "countedUnits", "name", "version", "createdAt"],
	legs: ["createdAt"],
	rateSwitches: ["previousType", "createdAt"],
	transfers: ["note"],
};

const skipped = (
	id: string,
	code: "changed_since" | "gone_already",
): WriteVerdict => ({ id, outcome: "skipped", code });

/** The verdict for one account-family row; null for a snapshot, which is not compared. */
export function compareWealth(
	live: Reader,
	change: WealthChange,
	acked: AckedWrite,
): WriteVerdict | null {
	if (change.table === "snapshots") return null;
	const { id, table } = change;
	const pulled = live.get(table, id);
	if (change.after === null) {
		return pulled
			? { id, outcome: "differs", fields: ["deleted"] }
			: { id, outcome: "match" };
	}
	if (!pulled) return skipped(id, "gone_already");
	if (
		table === "accounts" &&
		acked.version !== null &&
		String((pulled as { version: number }).version) !== acked.version
	)
		return skipped(id, "changed_since");
	const fields = differingColumns(
		table,
		change.after,
		pulled,
		NOT_COMPARED[table],
	);
	return fields.length === 0
		? { id, outcome: "match" }
		: { id, outcome: "differs", fields };
}
