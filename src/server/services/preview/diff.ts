import type { FigureReading, Money } from "~/server/figures/registry";
import type {
	FigureChange,
	FiguresDiff,
	FigureUnavailable,
	FigureUnchanged,
} from "./types";

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

/** Pairs two readings of one figure by currency; only lines whose amount differs are returned. */
export function diffReadings(
	id: string,
	before: readonly Money[],
	after: readonly Money[],
): FigureChange[] {
	const was = new Map(before.map((money) => [money.currency, money]));
	const now = new Map(after.map((money) => [money.currency, money]));
	const currencies = new Set([...was.keys(), ...now.keys()]);
	const changes: FigureChange[] = [];
	for (const currency of currencies) {
		const a = was.get(currency) ?? null;
		const b = now.get(currency) ?? null;
		if (a?.minor === b?.minor) continue;
		changes.push({
			id,
			currency,
			before: a,
			after: b,
			delta: moneyDelta(currency, a, b),
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
	const unavailable: FigureUnavailable[] = [];
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
