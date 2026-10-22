/**
 * Proposals the assign and cover sheets start from, read off one month view
 * so they use exactly the numbers on the page.
 *
 * - Fill from targets ("Use my plan", SPEC §5.4 auto-fill order): what went
 *   over back to 0, bills by due date, Monthly, then Savings, until the
 *   money runs out. What is left stays Not planned yet; nothing moves it
 *   unseen (D-owner-2026-10-22e).
 * - Cover sources (SPEC §6.5): To assign if positive, then Monthly envelopes
 *   by Left, then Savings, then Bills last with their due date.
 * - Move caps (S15): a move out of an envelope takes at most max(0, Left).
 */
import type {
	CoverSource,
	EnvelopeRowDto,
	FillFromTargetsOutput,
	GetMonthOutput,
} from "~/lib/schemas/envelope";
import { autoFill, type FillCandidate } from "./auto-fill";
import type { Minor } from "./types";

function rowsOf(
	view: GetMonthOutput,
): Array<EnvelopeRowDto & { order: number }> {
	return view.groups.flatMap((g, gi) =>
		g.envelopes.map((e, ei) => ({ ...e, order: gi * 10_000 + ei })),
	);
}

/** "Use my plan" for `amount` (default: all of a positive To assign). */
export function fillFromTargets(
	view: GetMonthOutput,
	amount?: Minor,
): FillFromTargetsOutput {
	const currency = view.book.currency;
	const available = Math.max(0, amount ?? view.toAssign.amount.minor);
	const candidates: FillCandidate[] = rowsOf(view).map((r) => ({
		envelopeId: r.id,
		kind: r.kind,
		order: r.order,
		left: r.left.minor,
		need: r.target?.need.minor ?? 0,
		dueDate: r.target?.dueDate ?? null,
	}));
	const { lines, left } = autoFill(available, candidates);
	return {
		month: view.month.key,
		available: { minor: available, currency },
		lines: lines.map((l) => ({
			envelopeId: l.envelopeId,
			amount: { minor: l.amount, currency },
			step: l.step,
		})),
		rest: { minor: left, currency },
	};
}

const KIND_RANK = { MONTHLY: 0, NONE: 0, SAVINGS: 1, BILL: 2 } as const;

/** Where money to cover `envelopeId` can come from, largest first within each tier. */
export function coverSources(
	view: GetMonthOutput,
	envelopeId: string,
): CoverSource[] {
	const currency = view.book.currency;
	const pool: CoverSource[] =
		view.toAssign.amount.minor > 0
			? [
					{
						from: null,
						kind: "POOL",
						available: view.toAssign.amount,
						dueDate: null,
					},
				]
			: [];
	const envelopes = rowsOf(view)
		.filter((r) => r.id !== envelopeId && r.left.minor > 0)
		.sort(
			(a, b) =>
				KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.left.minor - a.left.minor,
		)
		.map(
			(r): CoverSource => ({
				from: r.id,
				kind: r.kind,
				available: { minor: r.left.minor, currency },
				dueDate: r.kind === "BILL" ? (r.target?.dueDate ?? null) : null,
			}),
		);
	return [...pool, ...envelopes];
}

/** The most a move can take out of an envelope (S15). */
export function moveCap(row: Pick<EnvelopeRowDto, "left">): Minor {
	return Math.max(0, row.left.minor);
}
