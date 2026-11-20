import type { RetrospendClient } from "@retrospend/api-client";
import type { PreviewDto, PreviewState } from "@/features/entry/preview";

// The writes behind the Activity bulk bar. Each is one dry run of the whole
// set first (R30) and one write second, and hands back one undo token (R15).

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
				? await api.expenses.previewBulkDelete({ ids: [...ids] }, options)
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
): Promise<BulkResult> {
	const options = { context: { idempotencyKey: batch } };
	if (action.kind === "category") {
		const out = await api.expenses.bulkCategory(
			{ ids: [...ids], categoryId: action.categoryId },
			options,
		);
		return {
			done: out.updated,
			failed: ids.length - out.updated,
			tokens: [out.undo],
		};
	}
	const out = await api.expenses.bulkDelete({ ids: [...ids] }, options);
	return { done: out.deleted, failed: out.skipped.length, tokens: [out.undo] };
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
