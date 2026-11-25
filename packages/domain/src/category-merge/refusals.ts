/**
 * What a category merge or delete refuses, as one typed error with a stable
 * code. The domain knows no transport: the server maps `problem` to its
 * answer (the API v1 problem code of the same name; tRPC's `problemCode`) and
 * the web words each by the code, never by the English message.
 */

export type MergeRefusalCode =
	| "category_kind_mismatch"
	| "category_closed_month"
	| "category_income_rule";

export const MERGE_REFUSALS: Readonly<Record<MergeRefusalCode, string>> = {
	category_kind_mismatch:
		"An expense category and an income category cannot be merged.",
	category_closed_month:
		"A closed budget month files these two categories in different envelopes.",
	category_income_rule: "An income rule you cannot change uses this category.",
};

export class CategoryMergeRefusal extends Error {
	override readonly name = "CategoryMergeRefusal";
	constructor(readonly problem: MergeRefusalCode) {
		super(MERGE_REFUSALS[problem]);
	}
}
