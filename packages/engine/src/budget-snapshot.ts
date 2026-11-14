/**
 * The budget snapshot is double buffered (E2EE P13b, critic round 2 item 4).
 * `budgetSnapshot` is the last block whose gate passed (every cursor the device
 * holds has reached its `asOf`, and its valuation key matches the book's): the
 * figures read it. A pull writes the block it got to `budgetSnapshotPending`
 * and leaves the active one alone, so a device whose cursors lag behind the new
 * block still reads the last good one instead of nothing. The device decides
 * when the gate has passed and calls `promotePendingBudget` then.
 */
import { BUDGET_SNAPSHOT_ID, type Writer } from "./port";

/**
 * Moves the pending snapshot into the active one, in `tx`, and empties pending.
 * True when there was one to move; with none pending nothing changes.
 */
export function promotePendingBudget(tx: Writer): boolean {
	const pending = tx.get("budgetSnapshotPending", BUDGET_SNAPSHOT_ID);
	if (pending === undefined) return false;
	tx.put("budgetSnapshot", pending);
	tx.delete("budgetSnapshotPending", BUDGET_SNAPSHOT_ID);
	return true;
}
