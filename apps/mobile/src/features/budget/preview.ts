import type { Money } from "@retrospend/domain/money-minor";
import type { BudgetPreview } from "./source";

// What a budget write would change, from the server's own dry run of it (the
// preview twin runs the real write and rolls it back). The sheet words the
// rows; every amount in them is the server's.

export interface EnvelopeMove {
	id: string;
	before: Money;
	after: Money;
}

export interface FigureMove {
	before: Money | null;
	after: Money | null;
}

export interface BudgetPreviewRows {
	/** Each envelope the write moved, with its Left before and after. */
	envelopes: EnvelopeMove[];
	/** Not planned yet (or To assign) before and after; null when the write leaves it alone. */
	pool: FigureMove | null;
	/** Left to spend: changed, or the amount that stays. */
	leftToSpend: { change: FigureMove } | { stays: Money[] } | null;
}

const POOL_FIGURE = "budget.notPlannedYet";
const LEFT_FIGURE = "budget.leftToSpend";

function isMoney(value: unknown): value is Money {
	const m = value as Money | null;
	return (
		typeof m === "object" &&
		m !== null &&
		typeof m.minor === "number" &&
		typeof m.currency === "string"
	);
}

/** A figure line that is money; a percent line is not and is left out. */
function money(line: { minor: number; currency: string } | null): Money | null {
	return line && line.currency !== "%" ? line : null;
}

/** The movement answer a write would give, when the write moves envelopes. */
function envelopeMoves(preview: BudgetPreview): EnvelopeMove[] {
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

export function previewRows(preview: BudgetPreview): BudgetPreviewRows {
	const pool = preview.changes.find((c) => c.id === POOL_FIGURE);
	const left = preview.changes.find((c) => c.id === LEFT_FIGURE);
	const kept = preview.unchanged.find((u) => u.id === LEFT_FIGURE);
	return {
		envelopes: envelopeMoves(preview),
		pool: pool
			? { before: money(pool.before), after: money(pool.after) }
			: null,
		leftToSpend: left
			? { change: { before: money(left.before), after: money(left.after) } }
			: kept
				? { stays: kept.lines.flatMap((line) => money(line) ?? []) }
				: null,
	};
}

/** Whether the dry run says the write would do anything at all. */
export function changesAnything(rows: BudgetPreviewRows): boolean {
	return (
		rows.envelopes.some((e) => e.before.minor !== e.after.minor) ||
		rows.pool !== null ||
		(rows.leftToSpend !== null && "change" in rows.leftToSpend)
	);
}
