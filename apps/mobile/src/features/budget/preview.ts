import type { Money } from "@retrospend/domain/money-minor";
import { ENVELOPE_LEFT, figureLines } from "./figures";
import type { BudgetPreview } from "./source";

// What a budget write would change, from the server's own dry run of it (the
// preview twin runs the real write and rolls it back). The envelopes a write
// moved come from the answer it would give; every figure comes from the
// preview's own lists (figures.ts).

export interface EnvelopeMove {
	id: string;
	before: Money;
	after: Money;
}

function isMoney(value: unknown): value is Money {
	const m = value as Money | null;
	return (
		typeof m === "object" &&
		m !== null &&
		typeof m.minor === "number" &&
		typeof m.currency === "string"
	);
}

/** The envelopes a write moved, with their Left before and after, when the answer lists them. */
export function envelopeMoves(preview: BudgetPreview): EnvelopeMove[] {
	const detail = preview.detail as
		| { result?: { envelopes?: unknown } }
		| undefined;
	const list = detail?.result?.envelopes;
	if (!Array.isArray(list)) return [];
	return list.flatMap((row) => {
		const r = row as { id?: unknown; before?: unknown; after?: unknown };
		return typeof r.id === "string" && isMoney(r.before) && isMoney(r.after)
			? [{ id: r.id, before: r.before, after: r.after }]
			: [];
	});
}

/** Figure ids the envelope lines already say: not repeated once they are listed. */
export function hiddenFor(moves: readonly EnvelopeMove[]): string[] {
	return moves.length > 0 ? [ENVELOPE_LEFT] : [];
}

/** Whether the dry run says the write would do anything at all. */
export function changesAnything(preview: BudgetPreview): boolean {
	const moves = envelopeMoves(preview);
	return (
		moves.some((e) => e.before.minor !== e.after.minor) ||
		figureLines(preview, hiddenFor(moves)).changes.length > 0
	);
}
