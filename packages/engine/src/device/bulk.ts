import type { BulkSkip } from "@retrospend/domain/expense-write/bulk";
import { NotFoundError } from "../errors";
import {
	categorizeExpenses,
	deleteExpenses,
	EXPENSE_CATEGORIZE,
	EXPENSE_DELETE_MANY,
} from "../expense-bulk-local";
import { recordWrite, type WriteFn } from "../local-db";
import { InvalidInputError, type Reader, type Writer } from "../port";
import {
	createDevicePreviewRunner,
	deviceMutation,
	EXPENSE_FIGURES,
} from "../preview";
import { deviceFigures } from "../registry";
import { compareWrite, type WriteVerdict } from "../write-parity";
import { pendingChangesOf, type WriteCursors } from "./book";
import {
	countsInOverlay,
	type PendingChange,
	type PendingEntry,
} from "./pending";
import {
	differingFigures,
	type PreviewCompareDeps,
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
	changes: PendingChange[];
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
	changes: readonly PendingChange[];
}

/** The columns a bulk categorize sets; another difference means the row was written since. */
const CATEGORIZED = new Set([
	"categoryId",
	"categoryKind",
	"excludeFromAnalytics",
]);

/**
 * One changed row against the row a later pull brought. A categorize row that
 * differs outside the columns it set was edited elsewhere since: a skip, not a
 * finding (the v1 answer names no row versions to tell the two apart).
 */
export function compareBulkRow(
	live: Reader,
	change: PendingChange,
	bookedAt: number,
): WriteVerdict {
	const verdict = compareWrite(live, change, { bookedAt, version: null });
	return verdict.outcome === "differs" &&
		change.after !== null &&
		verdict.fields.some((f) => !CATEGORIZED.has(f))
		? { id: change.id, outcome: "skipped", code: "changed_since" }
		: verdict;
}

/** Whether an unsent or acked entry the server has not shown back touches any of `ids`. */
export const pendingAhead = (
	entries: readonly PendingEntry[],
	settledPull: number,
	ids: readonly string[],
) =>
	entries.some(
		(e) =>
			countsInOverlay(e, settledPull) &&
			e.changes.some((c) => ids.includes(c.id)),
	);

/**
 * The device preview of `op`, held against the server's dry run. While an
 * entry the server has not shown back touches a picked id the two start from
 * different rows, so nothing is compared (`pending_ahead`).
 */
export async function comparePreviewBulk(
	deps: PreviewCompareDeps,
	op: BulkOp,
	server: ServerPreview,
): Promise<WriteVerdict> {
	const id = op.ids[0] ?? "";
	if (pendingAhead(deps.entries, deps.settledPull, op.ids))
		return { id, outcome: "skipped", code: "pending_ahead" };
	try {
		const { id: mutationId, write } = bulkPlanOf(op, deps.cursors);
		const runner = createDevicePreviewRunner({
			store: deps.store,
			figures: deviceFigures({ clock: deps.now }),
			actor: { userId: deps.userId },
		});
		const diff = await runner.preview(
			deviceMutation<void, unknown>({
				id: mutationId,
				touches: EXPENSE_FIGURES,
				write: () => write,
			}),
			undefined,
		);
		const fields = differingFigures(diff, server);
		return fields.length === 0
			? { id, outcome: "match" }
			: { id, outcome: "differs", fields };
	} catch (error) {
		if (error instanceof InvalidInputError || error instanceof NotFoundError)
			return { id, outcome: "refused" };
		throw error;
	}
}
