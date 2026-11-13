/**
 * What counts as plaintext in a mapped cell, in one place (E2EE D11 PR 9.1).
 * The sealed pg suite's sweep (src/test/sealed-sweep.ts) and the operator's
 * scripts/verify-sealing.ts both use it, so the test guard and the production
 * check cannot drift apart. It reads no database and no environment.
 *
 * Plaintext is any text, "" too, that is not sealed; the one exception is the
 * `budget_book.name` default ("Personal"). A JSON body cell holds plaintext
 * unless it is null or a `{ sealed }` envelope. A leaves cell is read string
 * by string: a string at a declared leaf path must be sealed, and any other
 * string must be classified as no text (json-no-text.ts).
 */
import { isSealedField } from "./field-crypto";
import type { JsonCell } from "./fields";
import { classifyAuditLeaf } from "./json-no-text";

/** A SQL boolean for a text cell that holds a value, sealed or not. */
export const hasTextSql = (column: string): string => `"${column}" IS NOT NULL`;

/** A SQL boolean for a text cell that holds plaintext. */
export const plainTextSql = (table: string, column: string): string =>
	`"${column}" IS NOT NULL AND NOT starts_with("${column}", E'\\x01k1:')
	${table === "budget_book" ? `AND "${column}" <> 'Personal'` : ""}`;

/** A SQL boolean for a JSON body cell that holds a value. */
export const hasBodySql = (column: string): string =>
	`"${column}" IS NOT NULL AND jsonb_typeof("${column}") <> 'null'`;

/** A SQL boolean for a JSON body cell that holds plaintext. */
export const plainBodySql = (column: string): string =>
	`${hasBodySql(column)}
	AND NOT starts_with(COALESCE("${column}"->>'sealed', ''), E'\\x01k1:')`;

/** Every string of a JSON value with the path to it, arrays by index. */
export function* stringLeaves(
	value: unknown,
	path: string[] = [],
): Generator<[string[], string]> {
	if (typeof value === "string") yield [path, value];
	else if (Array.isArray(value))
		for (const [i, item] of value.entries())
			yield* stringLeaves(item, [...path, String(i)]);
	else if (typeof value === "object" && value !== null)
		for (const [key, item] of Object.entries(value))
			yield* stringLeaves(item, [...path, key]);
}

/**
 * `legacy_copy` is a leaf kept as its source cell's own text that is still
 * plaintext (a payment confirm's `previous`, confirm-restore.ts). The source
 * is plaintext too until the D12 reseal, so the copy is not new plaintext:
 * verify-sealing lists it apart and leaves it out of the "written after the
 * epoch" rule. Only those leaves are classified so; the baseline still counts
 * them.
 */
export type LeafState = "sealed" | "plaintext" | "undeclared" | "legacy_copy";

/**
 * The string leaves of a leaves cell value that hold text, each as sealed,
 * plaintext (a declared leaf that is not sealed), legacy_copy (a leaf kept as
 * its source cell's text that is not sealed) or undeclared (a string nobody
 * classified). Strings classified as no text are left out.
 */
export function* textLeaves(
	value: unknown,
	cell: Extract<JsonCell, { mode: "leaves" }>,
): Generator<{ path: string[]; text: string; state: LeafState }> {
	for (const [path, text] of stringLeaves(value)) {
		const kind = classifyAuditLeaf(path, cell);
		if (kind === "undeclared") yield { path, text, state: "undeclared" };
		else if (kind !== "no_text")
			yield {
				path,
				text,
				state: isSealedField(text)
					? "sealed"
					: kind === "source_sealed"
						? "legacy_copy"
						: "plaintext",
			};
	}
}
