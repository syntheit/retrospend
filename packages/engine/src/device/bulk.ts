import type { BulkSkip } from "@retrospend/domain/expense-write/bulk";
import {
	categorizeExpenses,
	deleteExpenses,
	EXPENSE_CATEGORIZE,
	EXPENSE_DELETE_MANY,
} from "../expense-bulk-local";
import { recordWrite, type WriteFn } from "../local-db";
import type { Reader, Writer } from "../port";
import { compareWrite, type WriteVerdict } from "../write-parity";
import { pendingChangesOf, type WriteCursors } from "./book";
import type { ExpenseChange } from "./pending";
import {
	type PreviewCompareDeps,
	previewVerdict,
	type ServerPreview,
} from "./preview-compare";

// The phone's bulk categorize and bulk delete, as the device books them. Bulk
// stays online: nothing is queued, and the phone refuses while any picked id
// has an outbox or acked entry, so this runs over pulled rows. The booking is
// held against the server's preview, against its answer, and, after the next
// pull, against the rows the pull brings.

export type BulkOp =
	| { kind: "categorize"; categoryId: string; ids: readonly string[] }
	| { kind: "deleteMany"; ids: readonly string[] };

/** The mutation id and write function of `op`. */
export function bulkPlanOf(
	op: BulkOp,
	cursors: WriteCursors,
): { id: string; write: WriteFn<Pick<BulkBooked, "skipped" | "reached">> } {
	return op.kind === "deleteMany"
		? {
				id: EXPENSE_DELETE_MANY,
				write: async (r) => {
					const done = await deleteExpenses({ ids: op.ids, cursors })(r);
					return { skipped: done.skipped, reached: done.deleted.length };
				},
			}
		: {
				id: EXPENSE_CATEGORIZE,
				write: async (r) => {
					const done = await categorizeExpenses({
						moves: [{ categoryId: op.categoryId, ids: op.ids }],
						cursors,
					})(r);
					return { skipped: done.skipped, reached: done.updated };
				},
			};
}

/** What the device booked for a bulk action. */
export interface BulkBooked {
	/** Epoch ms the device booked it. */
	bookedAt: number;
	/** Each expense it changed. */
	changes: ExpenseChange[];
	/** The rows it left alone, with the reason. */
	skipped: BulkSkip[];
	/** Rows it took: a categorize counts one already in the category. */
	reached: number;
}

/** Books `op` in `tx` (a transaction the caller throws away). A refusal throws InvalidInputError or NotFoundError. */
export async function bookBulkIn(
	tx: Writer,
	op: BulkOp,
	cursors: WriteCursors,
	bookedAt: number,
): Promise<BulkBooked> {
	const { id, write } = bulkPlanOf(op, cursors);
	const { value, undo } = await recordWrite(tx, id, write);
	return { bookedAt, changes: pendingChangesOf(undo), ...value };
}

/** What the server answered: how many rows it took, and which ids a delete left alone (a categorize names none). */
export interface BulkAnswer {
	reached: number;
	skipped: readonly string[] | null;
	/** The server's `Date` header of the answer (an HTTP date); never the phone's clock. */
	serverTime?: string | null;
}

/**
 * The skipped rows as verdicts, held against the answer. A row the device and
 * the server both left alone retires as `gone_already` (not the person's, or
 * gone) or `refused` (a transfer's fee, a spread parent). A disagreement is a
 * finding: ids and field names only.
 */
export function answerVerdicts(
	booked: BulkBooked,
	answer: BulkAnswer,
	ids: readonly string[],
): WriteVerdict[] {
	const mine = new Set(booked.skipped.map((s) => s.id));
	const verdicts: WriteVerdict[] = booked.skipped.map(({ id, reason }) =>
		answer.skipped && !answer.skipped.includes(id)
			? { id, outcome: "differs", fields: ["skipped"] }
			: reason === "notFound"
				? { id, outcome: "skipped", code: "gone_already" }
				: { id, outcome: "skipped", code: "refused" },
	);
	for (const id of answer.skipped ?? [])
		if (!mine.has(id))
			verdicts.push({ id, outcome: "differs", fields: ["skipped"] });
	// A categorize names no skipped id, so a count that differs is held on the first pick.
	if (
		!answer.skipped &&
		answer.reached !== booked.reached &&
		ids[0] !== undefined
	)
		verdicts.push({ id: ids[0], outcome: "differs", fields: ["reached"] });
	return verdicts;
}

/** A bulk action the server took, waiting for the pull that will show its rows. */
export interface BulkSent {
	/** `DeviceEngine.pullsBegun` at the answer: a pull that began after it has seen the write. */
	pull: number;
	bookedAt: number;
	changes: readonly ExpenseChange[];
	/** Every id the action changed or may have changed: the phone waits ("Sync first") until a pull has settled them. */
	ids: readonly string[];
	/** The server's clock at its answer, epoch ms; null when it gave none. */
	serverAt: number | null;
}

/** The columns a bulk categorize sets; another difference means the row was written since. */
const CATEGORIZED = new Set([
	"categoryId",
	"categoryKind",
	"excludeFromAnalytics",
]);

/** What tells a later write from the bulk action's own. */
export interface WrittenSince {
	/** The phone booked a write for this row at or after the bulk action. */
	laterBooking: boolean;
	serverAt: number | null;
}

/**
 * Whether the pulled row was written after the bulk action. Its `updatedAt` is
 * the server's clock and the answer's `Date` the same clock, whole seconds and
 * stamped after the write: a row stamped a full second past it is later. A
 * time that cannot be read counts as later (a skip is safe, a false finding
 * is not).
 */
function writtenSince(
	live: Reader,
	id: string,
	{ laterBooking, serverAt }: WrittenSince,
): boolean {
	if (laterBooking || serverAt === null) return true;
	const at = Date.parse(live.get("expenses", id)?.version ?? "");
	return Number.isNaN(at) || at >= serverAt + 1000;
}

/**
 * One changed row against the row a later pull brought. A categorize row that
 * differs, but was written since (by this phone or another device) or differs
 * outside the columns it set, is a skip, not a finding: the v1 answer names
 * no row versions to tell the bulk action's write from a later one.
 */
export function compareBulkRow(
	live: Reader,
	change: ExpenseChange,
	bookedAt: number,
	since: WrittenSince,
): WriteVerdict {
	const verdict = compareWrite(live, change, { bookedAt, version: null });
	if (verdict.outcome !== "differs" || change.after === null) return verdict;
	return verdict.fields.some((f) => !CATEGORIZED.has(f)) ||
		writtenSince(live, change.id, since)
		? { id: change.id, outcome: "skipped", code: "changed_since" }
		: verdict;
}

/** The device preview of `op`, held against the server's dry run (see `previewVerdict`). */
export const comparePreviewBulk = (
	deps: PreviewCompareDeps,
	op: BulkOp,
	server: ServerPreview,
): Promise<WriteVerdict> =>
	previewVerdict(deps, op.ids, () => bulkPlanOf(op, deps.cursors), server);
