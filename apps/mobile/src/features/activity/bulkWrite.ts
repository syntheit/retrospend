import type { RetrospendClient } from "@retrospend/api-client";
import type { BulkOp } from "@retrospend/engine/device";
import type { DeviceBulkWrites } from "@/data/device-engine";
import { deviceBulkWrites } from "@/data/deviceWrites";
import type { Outbox } from "@/data/outbox";
import { targetsWithEntries } from "@/data/outbox-chain";
import type { PreviewDto, PreviewState } from "@/features/entry/preview";

// The writes behind the Activity bulk bar. Each is one dry run of the whole
// set first (R30) and one write second, and hands back one undo token (R15).

export type BulkAction =
	| { kind: "delete" }
	| { kind: "category"; categoryId: string; name: string };

type Api = Pick<RetrospendClient, "expenses">;

/**
 * Dev flag: the device books the action beside the server's, and an action
 * waits while any picked id still has an unsent or acked write (the v1 bulk
 * calls carry no stamps, so a write the server has not shown back would be
 * booked from different rows). Null with the flag off: nothing below changes.
 */
export interface BulkDevice {
	writes: DeviceBulkWrites;
	outbox: Outbox;
}

/** The device side of a bulk action, or null when the flag is off or no outbox is open. */
export function bulkDevice(
	api: RetrospendClient,
	outbox: Outbox | undefined,
): BulkDevice | null {
	const writes = outbox ? deviceBulkWrites(api) : null;
	return outbox && writes ? { writes, outbox } : null;
}

/** An action was refused because a picked id has an outbox or acked entry: "Sync first". */
export class SyncFirstError extends Error {
	constructor() {
		super("sync_first");
	}
}

/** The picked ids an outbox or acked entry still names, in the order picked. */
export async function unsyncedIds(
	device: BulkDevice,
	ids: readonly string[],
): Promise<string[]> {
	const { open, acked } = await device.outbox.snapshot();
	return targetsWithEntries([...open, ...acked], ids);
}

const opOf = (action: BulkAction, ids: readonly string[]): BulkOp =>
	action.kind === "delete"
		? { kind: "deleteMany", ids }
		: { kind: "categorize", categoryId: action.categoryId, ids };

/** No answer for this long reads as offline: a bulk write does not wait on the phone. */
const PREVIEW_TIMEOUT_MS = 8000;

/** What the write would change, from the server's dry run of it. */
export async function previewBulk(
	api: Api,
	action: BulkAction,
	ids: readonly string[],
	device: BulkDevice | null = null,
): Promise<PreviewState> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), PREVIEW_TIMEOUT_MS);
	const options = { signal: timeout.signal };
	try {
		const diff =
			action.kind === "delete"
				? await api.expenses.previewBulkDelete({ ids: [...ids] }, options)
				: await api.expenses.previewBulkCategory(
						{ ids: [...ids], categoryId: action.categoryId },
						options,
					);
		// The device's own preview is held against this one: it shows nothing,
		// and offline stays offline (no device preview stands in for the server's).
		void device?.writes
			.comparePreviewBulk(opOf(action, ids), diff)
			.catch(() => undefined);
		return { status: "ready", diff };
	} catch (error) {
		const { status } = (error ?? {}) as { status?: number };
		if (status === undefined || status === 401) return { status: "offline" };
		return { status: "refused", reason: "other", currency: "" };
	} finally {
		clearTimeout(timer);
	}
}

/** How many of the picked entries a delete would skip, from its dry run. */
export function skippedOf(diff: PreviewDto): number {
	const detail = diff.detail as
		| { kind?: string; skipped?: unknown[] }
		| undefined;
	return detail?.kind === "expense.deleteMany" && Array.isArray(detail.skipped)
		? detail.skipped.length
		: 0;
}

export interface BulkResult {
	/** Entries the write changed. */
	done: number;
	/** Entries it left as they were (one the server skipped). */
	failed: number;
	/** One per write, newest last; each takes its write back. */
	tokens: string[];
}

/**
 * Sends the write: one request for the whole set, keyed by `batch`, so a
 * retry of the same tap replays instead of writing twice. An entry the server
 * skips (a transfer's fee) does not stop the others; the result says how many
 * went.
 */
export async function runBulk(
	api: Api,
	action: BulkAction,
	ids: readonly string[],
	batch: string,
	device: BulkDevice | null = null,
): Promise<BulkResult> {
	const options = { context: { idempotencyKey: batch } };
	// Checked again at the tap: a write may have been saved while the sheet was open.
	if (device && (await unsyncedIds(device, ids)).length > 0)
		throw new SyncFirstError();
	const booked = (await device?.writes.bookBulk(opOf(action, ids))) ?? null;
	const settle = (reached: number, skipped: readonly string[] | null) => {
		try {
			if (booked)
				device?.writes.settleBulk(batch, booked, { reached, skipped }, ids);
		} catch {
			// The compare never turns a write the server took into an error.
		}
	};
	if (action.kind === "category") {
		const out = await api.expenses.bulkCategory(
			{ ids: [...ids], categoryId: action.categoryId },
			options,
		);
		settle(out.updated, null);
		return {
			done: out.updated,
			failed: ids.length - out.updated,
			tokens: [out.undo],
		};
	}
	const out = await api.expenses.bulkDelete({ ids: [...ids] }, options);
	settle(out.deleted, out.skipped);
	return { done: out.deleted, failed: out.skipped.length, tokens: [out.undo] };
}

/** Takes every write of a batch back; false if any token was refused. */
export async function undoBulk(
	api: Api,
	tokens: readonly string[],
	batch: string,
	device: BulkDevice | null = null,
): Promise<boolean> {
	let ok = true;
	for (const [i, token] of tokens.entries()) {
		try {
			await api.expenses.undo(
				{ token },
				{ context: { idempotencyKey: `${batch}-undo-${i}` } },
			);
		} catch {
			ok = false;
		}
	}
	if (ok) device?.writes.undoneBulk(batch);
	return ok;
}
