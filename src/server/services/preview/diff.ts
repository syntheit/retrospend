import type { Money } from "~/server/figures/registry";
import type { FigureChange, FiguresDiff, FigureUnchanged } from "./types";

/** Figure id to value, in the order the figures were read. */
export type Snapshot = ReadonlyMap<string, Money | null>;

export function sameMoney(a: Money | null, b: Money | null): boolean {
	if (a === null || b === null) return a === b;
	return a.currency === b.currency && a.minor === b.minor;
}

/** after minus before, in minor units; null when there is nothing to subtract or the currencies differ. */
export function moneyDelta(
	before: Money | null,
	after: Money | null,
): Money | null {
	if (before === null || after === null) return null;
	if (before.currency !== after.currency) return null;
	const minor = after.minor - before.minor;
	if (!Number.isSafeInteger(minor)) {
		throw new RangeError(
			`delta of ${after.minor} and ${before.minor} is outside the safe range`,
		);
	}
	return { minor, currency: after.currency };
}

/**
 * Splits two snapshots into what changed and what did not. A figure present
 * on one side only counts as unavailable on the other, so it is listed as a
 * change rather than silently dropped.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): FiguresDiff {
	const ids = new Set([...before.keys(), ...after.keys()]);
	const changes: FigureChange[] = [];
	const unchanged: FigureUnchanged[] = [];
	for (const id of ids) {
		const a = before.get(id) ?? null;
		const b = after.get(id) ?? null;
		if (sameMoney(a, b)) {
			unchanged.push({ id, value: b });
		} else {
			changes.push({ id, before: a, after: b, delta: moneyDelta(a, b) });
		}
	}
	return { changes, unchanged };
}
