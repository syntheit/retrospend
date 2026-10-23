/**
 * What the review decides per row (keep, category, kind): the only thing
 * the client sends with Import. Rows already in Activity or without any rate
 * are never kept; the server applies the same rule, so these counts are the
 * ones the Import sheet's preview confirms.
 */
import type { ImportReview } from "~/server/services/import/review";
import type { ImportKind } from "~/server/services/import/rows";

export type ReviewRow = ImportReview["rows"][number];

export interface Choice {
	readonly keep: boolean;
	readonly categoryId: string | null;
	readonly kind: ImportKind;
}

export type Choices = Readonly<Record<number, Choice>>;

/** A row the import can create at all. */
export const importable = (r: ReviewRow) => !r.duplicate && !r.noRate;

/** The review's proposal, keeping whatever was already decided for a row. */
export function initialChoices(
	rows: readonly ReviewRow[],
	current: Choices = {},
): Choices {
	const next: Record<number, Choice> = {};
	for (const r of rows)
		next[r.index] = current[r.index] ?? {
			keep: importable(r),
			categoryId: r.categoryId,
			kind: r.kind,
		};
	return next;
}

export const isKept = (r: ReviewRow, choices: Choices) =>
	importable(r) && (choices[r.index]?.keep ?? false);

export interface ReviewCounts {
	readonly kept: number;
	/** Readable rows you unchecked. */
	readonly unchecked: number;
	readonly duplicates: number;
}

export function countsOf(
	rows: readonly ReviewRow[],
	choices: Choices,
): ReviewCounts {
	let kept = 0;
	let unchecked = 0;
	let duplicates = 0;
	for (const r of rows) {
		if (r.duplicate) duplicates++;
		else if (isKept(r, choices)) kept++;
		else if (!r.noRate) unchecked++;
	}
	return { kept, unchecked, duplicates };
}

/** Sets one field on a row's choice. */
export function withChoice(
	choices: Choices,
	index: number,
	patch: Partial<Choice>,
): Choices {
	const old = choices[index];
	if (!old) return choices;
	return { ...choices, [index]: { ...old, ...patch } };
}

/** Keep (or skip) every row the import can create. */
export function withAllKept(
	rows: readonly ReviewRow[],
	choices: Choices,
	keep: boolean,
): Choices {
	const next: Record<number, Choice> = { ...choices };
	for (const r of rows) {
		const c = next[r.index];
		if (c && importable(r)) next[r.index] = { ...c, keep };
	}
	return next;
}

/**
 * Match categories: every row without a category whose file category is
 * `name` gets `categoryId`. Rows of another kind than the category's keep
 * theirs (an income row never takes an expense category).
 */
export function withMatched(
	rows: readonly ReviewRow[],
	choices: Choices,
	matches: Readonly<Record<string, string>>,
	expenseKind: (categoryId: string) => boolean,
): Choices {
	const next: Record<number, Choice> = { ...choices };
	for (const r of rows) {
		const c = next[r.index];
		const id = matches[r.fileCategory];
		if (!c || !id || c.categoryId || r.duplicate) continue;
		if (expenseKind(id) === (c.kind !== "income"))
			next[r.index] = { ...c, categoryId: id };
	}
	return next;
}

/** What import.commit takes. */
export function commitRows(rows: readonly ReviewRow[], choices: Choices) {
	return rows.map((r) => {
		const c = choices[r.index];
		return {
			index: r.index,
			keep: isKept(r, choices),
			categoryId: c?.categoryId ?? null,
			kind: c?.kind ?? r.kind,
		};
	});
}

/** Rows still without a category whose file names one: what Match categories offers. */
export function unmatchedNames(
	review: ImportReview,
	choices: Choices,
): { name: string; rows: number; suggestionId: string | null }[] {
	return review.unmatched.flatMap((u) => {
		const rows = review.rows.filter(
			(r) =>
				r.fileCategory === u.name &&
				!r.duplicate &&
				!choices[r.index]?.categoryId,
		).length;
		return rows > 0 ? [{ ...u, rows }] : [];
	});
}
