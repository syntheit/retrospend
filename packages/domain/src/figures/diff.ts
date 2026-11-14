import type { Money } from "../money-minor";
import type { FigureReading } from "./registry";

/** One currency line of a figure that moved. A side is null when the figure has no amount in that currency. */
export interface FigureChange {
	readonly id: string;
	readonly currency: string;
	readonly before: Money | null;
	readonly after: Money | null;
	/** after minus before, counting a missing side as zero. Always in `currency`: a diff never converts. */
	readonly delta: Money;
	/** Every currency line of the figure after the mutation, so a sheet can say "USD 20 stays". */
	readonly figureAfter: readonly Money[];
}

/** A figure none of whose currency lines moved, with what it holds. */
export interface FigureUnchanged {
	readonly id: string;
	readonly value: readonly Money[];
}

/**
 * A figure that could not be read on at least one side (for example a missing
 * rate, R14). It is never reported as a change or as unchanged, because
 * either claim would be a guess. Named apart from the FigureUnavailable
 * class, which is what a figure returns when it cannot compute.
 */
export interface UnavailableFigure {
	readonly id: string;
	readonly before: FigureReading;
	readonly after: FigureReading;
}

/** R30: exactly what moves, what was checked and does not, and what could not be checked. */
export interface FiguresDiff {
	readonly changes: readonly FigureChange[];
	readonly unchanged: readonly FigureUnchanged[];
	readonly unavailable: readonly UnavailableFigure[];
}

/** Figure id to reading, in the order the figures were read. */
export type Snapshot = ReadonlyMap<string, FigureReading>;

/** after minus before in one currency, a missing side counting as zero. */
export function moneyDelta(
	currency: string,
	before: Money | null,
	after: Money | null,
): Money {
	const minor = (after?.minor ?? 0) - (before?.minor ?? 0);
	if (!Number.isSafeInteger(minor)) {
		throw new RangeError(
			`delta of ${after?.minor} and ${before?.minor} ${currency} is outside the safe range`,
		);
	}
	return { minor, currency };
}

/**
 * Pairs two readings of one figure by currency, in currency-code order, and
 * returns only lines whose amount differs. A missing line and a zero line
 * hold the same amount, so a balance going from absent to 0 is no change.
 */
export function diffReadings(
	id: string,
	before: readonly Money[],
	after: readonly Money[],
): FigureChange[] {
	const was = new Map(before.map((money) => [money.currency, money]));
	const now = new Map(after.map((money) => [money.currency, money]));
	const currencies = [...new Set([...was.keys(), ...now.keys()])].sort();
	const changes: FigureChange[] = [];
	for (const currency of currencies) {
		const a = was.get(currency) ?? null;
		const b = now.get(currency) ?? null;
		if ((a?.minor ?? 0) === (b?.minor ?? 0)) continue;
		changes.push({
			id,
			currency,
			before: a,
			after: b,
			delta: moneyDelta(currency, a, b),
			figureAfter: after,
		});
	}
	return changes;
}

/**
 * Splits two snapshots into what changed, what did not and what could not be
 * read. A figure missing from one snapshot counts as unavailable there, so it
 * is listed rather than silently dropped.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): FiguresDiff {
	const ids = new Set([...before.keys(), ...after.keys()]);
	const changes: FigureChange[] = [];
	const unchanged: FigureUnchanged[] = [];
	const unavailable: UnavailableFigure[] = [];
	for (const id of ids) {
		const a = before.get(id) ?? null;
		const b = after.get(id) ?? null;
		if (a === null || b === null) {
			unavailable.push({ id, before: a, after: b });
			continue;
		}
		const moved = diffReadings(id, a, b);
		if (moved.length === 0) unchanged.push({ id, value: b });
		changes.push(...moved);
	}
	return { changes, unchanged, unavailable };
}
