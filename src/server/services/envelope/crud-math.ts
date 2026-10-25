/**
 * The pure math of envelope edits (budget stream 2B): how rerouted spending
 * is paid back to the envelopes it was taken from, and how targets add up
 * when envelopes are combined. No I/O; the services load rows and call these.
 */
import type { TargetSnapshot } from "~/lib/schemas/envelope-book";
import type { Minor } from "./types";
import { Dec } from "./units";

export interface Delta {
	id: string;
	/** Left after the edit minus Left before, in the current month. */
	delta: Minor;
}

export interface Settle {
	from: string;
	to: string;
	minor: Minor;
}

/**
 * Moving a category link reroutes this month's spending, so one envelope
 * gains Left and another loses the same. Paying each gainer's surplus to the
 * losers, in id order, puts every Left back where it was: the spending moves
 * with the money that paid for it. The deltas of a reroute always add up to
 * 0 (spending only changes envelope), so nothing is left over.
 */
export function settleDeltas(deltas: readonly Delta[]): Settle[] {
	if (deltas.reduce((t, d) => t + d.delta, 0) !== 0)
		throw new RangeError("a reroute moves spending between envelopes only");
	const sorted = deltas
		.filter((d) => d.delta !== 0)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const gainers = sorted.filter((d) => d.delta > 0).map((d) => ({ ...d }));
	const losers = sorted
		.filter((d) => d.delta < 0)
		.map((d) => ({ id: d.id, owed: -d.delta }));
	const rows: Settle[] = [];
	for (const g of gainers) {
		for (const l of losers) {
			const minor = Math.min(g.delta, l.owed);
			if (minor === 0) continue;
			rows.push({ from: g.id, to: l.id, minor });
			g.delta -= minor;
			l.owed -= minor;
		}
	}
	return rows;
}

export interface MergedTarget {
	target: TargetSnapshot;
	/** Sources whose target was added to the stayer's or adopted by it. */
	summed: number;
	/** Sources with a target that could not be carried. */
	dropped: number;
}

/** A target with something to aim for: an amount, or a template or debt it follows. */
const hasTarget = (t: TargetSnapshot) =>
	t.kind !== "NONE" &&
	(t.targetAmount !== null ||
		t.targetMonthlyAmount !== null ||
		t.targetTemplateId !== null ||
		t.targetLiabilityId !== null);

/** A stayer takes a source's whole target only when the kinds agree (or it was No target), and Everything else stays Monthly. */
function adopts(
	into: TargetSnapshot,
	source: TargetSnapshot,
	intoIsDefault: boolean,
): boolean {
	if (intoIsDefault && source.kind !== "MONTHLY") return false;
	return into.kind === "NONE" || into.kind === source.kind;
}

/** Two Monthly targets add only when they mean the same thing: mode, cadence and currency. */
function addable(a: TargetSnapshot, b: TargetSnapshot): boolean {
	return (
		a.kind === "MONTHLY" &&
		b.kind === "MONTHLY" &&
		a.targetAmount !== null &&
		b.targetAmount !== null &&
		a.targetMode === b.targetMode &&
		a.targetCadence === b.targetCadence &&
		a.targetCurrency === b.targetCurrency
	);
}

/**
 * The target of the envelope that stays after combining (SPEC §5.13): Monthly
 * targets of the same kind add up; a stayer with no target adopts the first
 * source's; anything else keeps the stayer's and counts the source's as
 * dropped, so the preview can say so. Amounts stay in the currency typed (D25).
 */
export function mergeTargets(
	into: TargetSnapshot,
	from: readonly TargetSnapshot[],
	intoIsDefault = false,
): MergedTarget {
	let target = into;
	let summed = 0;
	let dropped = 0;
	for (const source of from) {
		if (!hasTarget(source)) continue;
		if (!hasTarget(target) && adopts(target, source, intoIsDefault)) {
			target = source;
			summed++;
		} else if (addable(target, source)) {
			target = {
				...target,
				targetAmount: new Dec(target.targetAmount as string)
					.add(source.targetAmount as string)
					.toString(),
			};
			summed++;
		} else dropped++;
	}
	return { target, summed, dropped };
}
