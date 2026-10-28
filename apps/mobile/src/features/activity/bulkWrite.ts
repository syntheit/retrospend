import type { RetrospendClient } from "@retrospend/api-client";
import type { PreviewState } from "@/features/entry/preview";
import { mergeDeletePreviews } from "./bulk";

// The writes behind the Activity bulk bar. Each is a dry run first (R30) and a
// write second, and each hands back the server's undo tokens (R15).

export type BulkAction =
	| { kind: "delete" }
	| { kind: "category"; categoryId: string; name: string };

type Api = Pick<RetrospendClient, "expenses">;

/** No answer for this long reads as offline: a bulk write does not wait on the phone. */
const PREVIEW_TIMEOUT_MS = 8000;

/** What the write would change, from the server's dry run of it. */
export async function previewBulk(
	api: Api,
	action: BulkAction,
	ids: readonly string[],
): Promise<PreviewState> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), PREVIEW_TIMEOUT_MS);
	const options = { signal: timeout.signal };
	try {
		const diff =
			action.kind === "delete"
				? mergeDeletePreviews(
						await Promise.all(
							ids.map((id) => api.expenses.previewDelete({ id }, options)),
						),
					)
				: await api.expenses.previewBulkCategory(
						{ ids: [...ids], categoryId: action.categoryId },
						options,
					);
		return { status: "ready", diff };
	} catch (error) {
		const { status } = (error ?? {}) as { status?: number };
		if (status === undefined || status === 401) return { status: "offline" };
		return { status: "refused", reason: "other", currency: "" };
	} finally {
		clearTimeout(timer);
	}
}

export interface BulkResult {
	/** Entries the write changed. */
	done: number;
	/** Entries it could not (a delete the server refused). */
	failed: number;
	/** One per write, newest last; each takes its write back. */
	tokens: string[];
}

/**
 * Sends the write. A category change is one request. Delete is one request
 * per entry, as on the web: an entry the server refuses does not stop the
 * others, and the result says how many went. `batch` makes every key unique to
 * this attempt, so a retry of the same tap replays instead of writing twice.
 */
export async function runBulk(
	api: Api,
	action: BulkAction,
	ids: readonly string[],
	batch: string,
): Promise<BulkResult> {
	if (action.kind === "category") {
		const out = await api.expenses.bulkCategory(
			{ ids: [...ids], categoryId: action.categoryId },
			{ context: { idempotencyKey: batch } },
		);
		return {
			done: out.updated,
			failed: ids.length - out.updated,
			tokens: [out.undo],
		};
	}
	const tokens: string[] = [];
	let failed = 0;
	for (const id of ids) {
		try {
			const out = await api.expenses.delete(
				{ id },
				{ context: { idempotencyKey: `${batch}-${id}` } },
			);
			tokens.push(out.undo);
		} catch {
			failed += 1;
		}
	}
	return { done: tokens.length, failed, tokens };
}

/** Takes every write of a batch back; false if any token was refused. */
export async function undoBulk(
	api: Api,
	tokens: readonly string[],
	batch: string,
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
	return ok;
}
