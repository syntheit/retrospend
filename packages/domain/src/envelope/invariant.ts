/**
 * The SPEC §5.3 invariant, asserted by every scenario:
 *   ToAssign(c) + Σ Left(e, c) + Assigned(c+1) = MoneyIn - Σ outflows - SplitsNet
 * Pure, test support for the engine (engine.ts).
 */
import { addMonths } from "./calendar";
import { type BookState, type EngineInput, sumLeft } from "./engine";
import type { Minor, MonthKey } from "./types";

/**
 * Both sides of the SPEC §5.3 invariant at the current month c, the right
 * side from the raw inputs (never from engine results), so a test that
 * compares them checks the engine against the ledger.
 */
export function invariantSides(
	input: EngineInput,
	state: BookState,
): { budget: Minor; ledger: Minor } {
	const c = input.currentMonth;
	const next = addMonths(c, 1);
	const inBook = (m: MonthKey) => m >= input.startMonth && m <= c;
	const sum = (xs: Iterable<Minor>) => {
		let t = 0;
		for (const x of xs) t += x;
		return t;
	};
	const moneyIn = sum(
		input.moneyIn.filter((r) => inBook(r.month)).map((r) => r.minor),
	);
	const outflows = sum(
		input.activity.filter((r) => inBook(r.month)).map((r) => r.minor),
	);
	const splits = input.splits.filter((s) => inBook(s.month));
	const term = (t: string) =>
		sum(splits.filter((s) => s.term === t).map((s) => s.minor));
	const splitsNet = term("FRONTED") - term("RETURNED") + term("OLD_DEBT_PAID");
	// Forgiven leaves SplitsNet and lands in Activity: both cancel in the ledger.
	const nextAssigned = sum(
		input.movements
			.filter((mv) => mv.month === next)
			.map(
				(mv) =>
					(mv.from === null ? mv.minor : 0) - (mv.to === null ? mv.minor : 0),
			),
	);
	return {
		budget: state.toAssign(c).total + sumLeft(state, c) + nextAssigned,
		ledger: moneyIn + outflows - splitsNet,
	};
}
