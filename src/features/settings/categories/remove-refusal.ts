import {
	MERGE_REFUSALS,
	type MergeRefusalCode,
} from "@retrospend/domain/category-merge/refusals";

const CODES = Object.keys(MERGE_REFUSALS) as MergeRefusalCode[];

/**
 * The refusal of a category delete or merge, by the problem code the server
 * sends (`data.problem`), never by its English message. Each code has its own
 * sentence in `settingsV2.categories.remove.refusals`. Null for any other
 * failure.
 */
export function removeRefusalOf(error: unknown): MergeRefusalCode | null {
	const problem = (error as { data?: { problem?: unknown } } | null)?.data
		?.problem;
	return CODES.find((code) => code === problem) ?? null;
}
