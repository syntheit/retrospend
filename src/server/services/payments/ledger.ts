/**
 * A pair's ledger as events (MONEY-MOVES §1.8, §1.9): every share and every
 * counted payment row between two people, in minor units, signed from one
 * side (A). Pure: balance.ts loads the events; balances, the oldest open
 * debt per line and "Settled since" are derived here, so the allocator, the
 * person page and the tests read one history.
 */
import { sumMinor } from "~/server/services/envelope/units";
import type { IsoDate, Minor, PairLine, Scope } from "./types";

export interface PairEvent {
	readonly date: IsoDate;
	readonly scope: Scope;
	readonly currency: string;
	/** Positive moves the balance towards "B owes A". */
	readonly minor: Minor;
	readonly kind: "share" | "payment";
	/** A payment row still waiting for the other side, counted because A recorded it (I5). */
	readonly pending?: boolean;
}

/** One (scope, currency) balance from A's side: positive = B owes A. */
export interface LedgerLine {
	readonly scope: Scope;
	readonly currency: string;
	readonly balance: Minor;
	/** Earliest share in the balance's direction not yet covered, first in first out. */
	readonly oldest: IsoDate | null;
}

const lineKey = (scope: Scope, currency: string) =>
	`${scope ?? ""}|${currency}`;

const byDate = (a: PairEvent, b: PairEvent) =>
	a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

function groupByLine(events: readonly PairEvent[]): Map<string, PairEvent[]> {
	const lines = new Map<string, PairEvent[]>();
	for (const event of events) {
		const key = lineKey(event.scope, event.currency);
		const list = lines.get(key) ?? [];
		list.push(event);
		lines.set(key, list);
	}
	return lines;
}

/**
 * The share that is still open once every earlier debt in the balance's
 * direction has been covered: covered = all debt in that direction minus
 * what is still owed, walked oldest first.
 */
function oldestOpen(
	events: readonly PairEvent[],
	balance: Minor,
): IsoDate | null {
	if (balance === 0) return null;
	const growing = events
		.filter(
			(e) => e.kind === "share" && Math.sign(e.minor) === Math.sign(balance),
		)
		.sort(byDate);
	const covered =
		sumMinor(growing.map((e) => Math.abs(e.minor))) - Math.abs(balance);
	let running = 0;
	for (const event of growing) {
		running += Math.abs(event.minor);
		if (running > covered) return event.date;
	}
	// Payments the other way can make a balance larger than its shares; then
	// the newest share is the open one.
	return growing.at(-1)?.date ?? null;
}

/** Every non-zero line, in scope then currency order. */
export function ledgerLines(events: readonly PairEvent[]): LedgerLine[] {
	const lines: LedgerLine[] = [];
	for (const list of groupByLine(events).values()) {
		const balance = sumMinor(list.map((e) => e.minor));
		if (balance === 0) continue;
		const { scope, currency } = list[0]!;
		lines.push({ scope, currency, balance, oldest: oldestOpen(list, balance) });
	}
	return lines.sort((a, b) =>
		lineKey(a.scope, a.currency) < lineKey(b.scope, b.currency) ? -1 : 1,
	);
}

/** Lines signed from the payer's side for allocatePayment: positive = the payer owes. */
export function payerLines(
	lines: readonly LedgerLine[],
	payerIsA: boolean,
): PairLine[] {
	return lines.map((l) => ({
		scope: l.scope,
		currency: l.currency,
		owed: payerIsA ? -l.balance : l.balance,
		oldest: l.oldest,
	}));
}

/** Per-currency totals over every scope (Overall(p, c), I1). */
export function overallByCurrency(
	lines: readonly LedgerLine[],
): Map<string, Minor> {
	const totals = new Map<string, Minor>();
	for (const l of lines)
		totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.balance);
	for (const [currency, total] of totals)
		if (total === 0) totals.delete(currency);
	return totals;
}

export interface SettledSince {
	/** Date after which every currency's overall balance has stayed at zero; null while any is not zero. */
	readonly overall: IsoDate | null;
	/** The zeroing record (or a later one) is still pending. */
	readonly pending: boolean;
	/** The same rule per scope (all of that scope's currencies). */
	readonly byScope: ReadonlyMap<Scope, IsoDate | null>;
	/** Nothing was ever shared with this person. */
	readonly nothingShared: boolean;
}

/** Walks the history day by day and keeps the start of the current zero stretch. */
function zeroSince(
	events: readonly PairEvent[],
	keyOf: (e: PairEvent) => string,
): IsoDate | null {
	const running = new Map<string, Minor>();
	const sorted = [...events].sort(byDate);
	let since: IsoDate | null = null;
	sorted.forEach((event, i) => {
		const key = keyOf(event);
		running.set(key, (running.get(key) ?? 0) + event.minor);
		if (sorted[i + 1]?.date === event.date) return;
		const zero = [...running.values()].every((v) => v === 0);
		if (!zero) since = null;
		else if (since === null) since = event.date;
	});
	return since;
}

/** "Settled since" (MONEY-MOVES §1.9, I7), overall and per scope. */
export function settledSince(events: readonly PairEvent[]): SettledSince {
	if (events.length === 0) {
		return {
			overall: null,
			pending: false,
			byScope: new Map(),
			nothingShared: true,
		};
	}
	const overall = zeroSince(events, (e) => e.currency);
	const byScope = new Map<Scope, IsoDate | null>();
	const scopes = new Set(events.map((e) => e.scope));
	for (const scope of scopes) {
		byScope.set(
			scope,
			zeroSince(
				events.filter((e) => e.scope === scope),
				(e) => e.currency,
			),
		);
	}
	const pending =
		overall !== null && events.some((e) => e.pending && e.date >= overall);
	return { overall, pending, byScope, nothingShared: false };
}

/** The confirmation fields of a settlement row, enough to decide whether it counts for someone. */
export interface CountableRow {
	readonly status: string;
	readonly confirmedByPayer: boolean;
	readonly confirmedByPayee: boolean;
}

/**
 * Whether a settlement row counts in the balance `viewer` sees (rule 2, I5).
 * Final rows count for everyone. A pending row counts only for the person
 * who recorded it, which is the side whose own flag is set (the payer of a
 * payment sent, either side of a square-up); the other side sees it as a
 * claim until they confirm. Someone who is neither party never counts it.
 * Rejected rows never count.
 */
export function countsFor(
	row: CountableRow,
	viewerSide: "from" | "to" | null,
): boolean {
	if (row.status === "FINALIZED") return true;
	if (row.status !== "PROPOSED" || viewerSide === null) return false;
	return viewerSide === "from" ? row.confirmedByPayer : row.confirmedByPayee;
}
