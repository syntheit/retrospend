/**
 * The envelope engine (budget SPEC §5.3, build plan 02 §3.1): every budget
 * month from the book's start to the month after today, from already-valued
 * inputs. Pure: the loader values rows in H minor units (valuation.ts) and
 * maps their dates to budget months (months.ts); nothing here does I/O.
 *
 *   ToAssign(m) = MoneyIn(<=m) - Assigned(<=a) - OverspendTaken(<m)
 *                 + Returned(<m) - SplitsNet(<=m),     a = m if m < c, else c+1
 *   Left(e, m)  = Carry(e, m-1) + Assigned(e, m) + Activity(e, m)
 *   Carry(e, k) = max(0, Left(e, k)) under CARRY, 0 under RETURN or SWEEP,
 *                 plus what envelopes sweeping into e leave
 *
 * Months before the viewed one count as closed with today's leftover rules:
 * month close with rule snapshots (MonthClose) arrives in P4. Viewing next
 * month projects the current month's close the same way.
 *
 * Invariant (SPEC §5.3, asserted by every scenario):
 *   ToAssign(c) + Σ Left(e, c) + Assigned(c+1) = MoneyIn - Σ outflows - SplitsNet
 */

import { addMonths } from "./calendar";
import { monthsFrom } from "./months";
import type { ReplayEffect } from "./splits-replay";
import type { EnvelopeKind, IsoDate, Minor, MonthKey } from "./types";
import { assertMinor } from "./units";

export type LeftoverRule = "CARRY" | "RETURN" | "SWEEP";

export interface EngineEnvelope {
	id: string;
	kind: EnvelopeKind;
	leftoverRule: LeftoverRule;
	sweepToId: string | null;
	categoryIds: readonly string[];
}

export type MoneyInSource = "INCOME" | "STARTING_BALANCE" | "ADJUSTMENT";

/** A row that raises (or, for an OUT adjustment, lowers) To assign. Signed. */
export interface MoneyInEntry {
	id: string;
	month: MonthKey;
	minor: Minor;
	source: MoneyInSource;
}

export type ActivitySource = "SPENT" | "REFUND" | "SHARE" | "FORGIVEN";

/** A row that moves an envelope's Activity. Signed: spending is negative, refunds positive. */
export interface ActivityEntry {
	id: string;
	month: MonthKey;
	date: IsoDate;
	minor: Minor;
	source: ActivitySource;
	categoryId: string | null;
	/** Set when the row is charged to one envelope whatever its category (forgive). */
	envelopeId?: string | null;
	/** A share still waiting for your OK: counted, flagged (D20). */
	pending?: boolean;
	/** Posted by a recurring template: left out of the pace line (D60). */
	recurring?: boolean;
}

export interface MovementEntry {
	id: string;
	month: MonthKey;
	/** null = To assign. */
	from: string | null;
	to: string | null;
	/** Positive. */
	minor: Minor;
}

export interface EngineInput {
	startMonth: MonthKey;
	/** The budget month that contains today (c). */
	currentMonth: MonthKey;
	defaultEnvelopeId: string;
	envelopes: readonly EngineEnvelope[];
	moneyIn: readonly MoneyInEntry[];
	activity: readonly ActivityEntry[];
	movements: readonly MovementEntry[];
	/** Splits replay effects (P3 wires the loader; empty until then). */
	splits: readonly ReplayEffect[];
}

export interface EnvelopeMonth {
	envelopeId: string;
	carryIn: Minor;
	assigned: Minor;
	activity: Minor;
	left: Minor;
	/** Σ pending shares in Activity (negative or 0). */
	pending: Minor;
	/** Σ outflows posted by recurring templates (negative or 0). */
	recurring: Minor;
}

export interface MonthTotals {
	moneyIn: Minor;
	/** Net movements out of To assign in this month. */
	assigned: Minor;
	activity: Minor;
	/** Σ max(0, -Left) at the end of the month. */
	overspent: Minor;
	/** Σ max(0, Left) of envelopes whose leftovers return. */
	returned: Minor;
	fronted: Minor;
	returnedByPeople: Minor;
	forgiven: Minor;
}

export interface MonthState {
	month: MonthKey;
	envelopes: ReadonlyMap<string, EnvelopeMonth>;
	totals: MonthTotals;
}

export interface ToAssignTerms {
	moneyIn: Minor;
	/** Net assigned through a (current and next month for m >= c). */
	assigned: Minor;
	/** The part of `assigned` that went to months after m (assigned ahead). */
	assignedAhead: Minor;
	overspendTaken: Minor;
	returned: Minor;
	fronted: Minor;
	returnedByPeople: Minor;
	forgiven: Minor;
	splitsNet: Minor;
	total: Minor;
}

export interface BookState {
	startMonth: MonthKey;
	currentMonth: MonthKey;
	/** Oldest first, startMonth to max(through, c + 1). */
	months: readonly MonthState[];
	month(key: MonthKey): MonthState;
	toAssign(key: MonthKey): ToAssignTerms;
	envelopeOf(entry: Pick<ActivityEntry, "categoryId" | "envelopeId">): string;
}

/** A movement or link that names an envelope the book does not have: a loader bug. */
export class EngineInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EngineInputError";
	}
}

function emptyTotals(): MonthTotals {
	return {
		moneyIn: 0,
		assigned: 0,
		activity: 0,
		overspent: 0,
		returned: 0,
		fronted: 0,
		returnedByPeople: 0,
		forgiven: 0,
	};
}

function bucket<T extends { month: MonthKey }>(
	rows: readonly T[],
	from: MonthKey,
	to: MonthKey,
): Map<MonthKey, T[]> {
	const out = new Map<MonthKey, T[]>();
	for (const row of rows) {
		if (row.month < from || row.month > to) continue;
		const list = out.get(row.month) ?? [];
		list.push(row);
		out.set(row.month, list);
	}
	return out;
}

function router(input: EngineInput) {
	const ids = new Set(input.envelopes.map((e) => e.id));
	if (!ids.has(input.defaultEnvelopeId))
		throw new EngineInputError("the default envelope is not in the book");
	const byCategory = new Map<string, string>();
	for (const e of input.envelopes)
		for (const c of e.categoryIds) byCategory.set(c, e.id);
	const known = (id: string) => {
		if (!ids.has(id)) throw new EngineInputError(`unknown envelope ${id}`);
		return id;
	};
	const envelopeOf = (
		entry: Pick<ActivityEntry, "categoryId" | "envelopeId">,
	) =>
		entry.envelopeId && ids.has(entry.envelopeId)
			? entry.envelopeId
			: ((entry.categoryId && byCategory.get(entry.categoryId)) ??
				input.defaultEnvelopeId);
	return { known, envelopeOf };
}

/** Forgiven balances are charged to their envelope in the forgive month (§5.8). */
function forgiveCharges(splits: readonly ReplayEffect[]): ActivityEntry[] {
	return splits
		.filter((s) => s.term === "FORGIVEN")
		.map((s) => ({
			id: `forgive:${s.eventId}`,
			month: s.month,
			date: "",
			minor: -s.minor,
			source: "FORGIVEN" as const,
			categoryId: null,
			envelopeId: s.envelopeId ?? null,
		}));
}

interface MonthBuckets {
	moneyIn: Map<MonthKey, MoneyInEntry[]>;
	activity: Map<MonthKey, ActivityEntry[]>;
	movements: Map<MonthKey, MovementEntry[]>;
	splits: Map<MonthKey, ReplayEffect[]>;
}

function monthState(
	month: MonthKey,
	carry: ReadonlyMap<string, Minor>,
	input: EngineInput,
	b: MonthBuckets,
	route: ReturnType<typeof router>,
): MonthState {
	const totals = emptyTotals();
	const rows = new Map<string, EnvelopeMonth>();
	for (const e of input.envelopes) {
		const carryIn = carry.get(e.id) ?? 0;
		rows.set(e.id, {
			envelopeId: e.id,
			carryIn,
			assigned: 0,
			activity: 0,
			left: 0,
			pending: 0,
			recurring: 0,
		});
	}
	const row = (id: string) => rows.get(id) as EnvelopeMonth;
	for (const m of b.moneyIn.get(month) ?? [])
		totals.moneyIn += assertMinor(m.minor);
	for (const mv of b.movements.get(month) ?? []) {
		if (mv.from === null) totals.assigned += mv.minor;
		else row(route.known(mv.from)).assigned -= mv.minor;
		if (mv.to === null) totals.assigned -= mv.minor;
		else row(route.known(mv.to)).assigned += mv.minor;
	}
	for (const a of b.activity.get(month) ?? []) {
		const r = row(route.envelopeOf(a));
		r.activity += assertMinor(a.minor);
		if (a.pending) r.pending += a.minor;
		if (a.recurring && a.minor < 0) r.recurring += a.minor;
		totals.activity += a.minor;
	}
	for (const s of b.splits.get(month) ?? []) {
		if (s.term === "FRONTED") totals.fronted += s.minor;
		else if (s.term === "RETURNED") totals.returnedByPeople += s.minor;
		else totals.forgiven += s.minor;
	}
	for (const r of rows.values()) {
		r.left = r.carryIn + r.assigned + r.activity;
		if (r.left < 0) totals.overspent -= r.left;
	}
	return { month, envelopes: rows, totals };
}

/** Leftovers after month k: carry, return or sweep (SPEC §5.5 step 1); bills, goals and No target always carry. */
function close(
	state: MonthState,
	envelopes: readonly EngineEnvelope[],
	totals: MonthTotals,
): Map<string, Minor> {
	const next = new Map<string, Minor>();
	const add = (id: string, v: Minor) => next.set(id, (next.get(id) ?? 0) + v);
	for (const e of envelopes) {
		const pos = Math.max(0, state.envelopes.get(e.id)?.left ?? 0);
		const rule = e.kind === "MONTHLY" ? e.leftoverRule : "CARRY";
		if (rule === "CARRY") add(e.id, pos);
		else if (rule === "RETURN") totals.returned += pos;
		else add(e.sweepToId ?? e.id, pos);
	}
	return next;
}

/** Runs every month from the book start to max(through, c + 1). */
export function computeBook(
	input: EngineInput,
	through: MonthKey = input.currentMonth,
): BookState {
	const last = Math.max(through, addMonths(input.currentMonth, 1));
	const first = input.startMonth;
	const route = router(input);
	const b: MonthBuckets = {
		moneyIn: bucket(input.moneyIn, first, last),
		activity: bucket(
			[...input.activity, ...forgiveCharges(input.splits)],
			first,
			last,
		),
		movements: bucket(input.movements, first, last),
		splits: bucket(input.splits, first, last),
	};
	for (const mv of input.movements) {
		if (mv.month < first)
			throw new EngineInputError(`movement ${mv.id} is before the book start`);
	}
	const months: MonthState[] = [];
	let carry = new Map<string, Minor>();
	for (const key of monthsFrom(first, last)) {
		const state = monthState(key, carry, input, b, route);
		carry = close(state, input.envelopes, state.totals);
		months.push(state);
	}
	const index = new Map(months.map((s) => [s.month, s]));
	const month = (key: MonthKey) => {
		const s = index.get(key);
		if (!s) throw new RangeError(`month ${key} is outside the book`);
		return s;
	};
	return {
		startMonth: first,
		currentMonth: input.currentMonth,
		months,
		month,
		toAssign: (key) => toAssignAt(months, input.currentMonth, month(key).month),
		envelopeOf: route.envelopeOf,
	};
}

function toAssignAt(
	months: readonly MonthState[],
	c: MonthKey,
	m: MonthKey,
): ToAssignTerms {
	const a = m < c ? m : addMonths(c, 1);
	const t: ToAssignTerms = {
		moneyIn: 0,
		assigned: 0,
		assignedAhead: 0,
		overspendTaken: 0,
		returned: 0,
		fronted: 0,
		returnedByPeople: 0,
		forgiven: 0,
		splitsNet: 0,
		total: 0,
	};
	for (const s of months) {
		if (s.month <= a) {
			t.assigned += s.totals.assigned;
			if (s.month > m) t.assignedAhead += s.totals.assigned;
		}
		if (s.month > m) continue;
		t.moneyIn += s.totals.moneyIn;
		t.fronted += s.totals.fronted;
		t.returnedByPeople += s.totals.returnedByPeople;
		t.forgiven += s.totals.forgiven;
		if (s.month < m) {
			t.overspendTaken += s.totals.overspent;
			t.returned += s.totals.returned;
		}
	}
	t.splitsNet = t.fronted - t.returnedByPeople - t.forgiven;
	t.total =
		t.moneyIn - t.assigned - t.overspendTaken + t.returned - t.splitsNet;
	return t;
}

/** Σ Left over every envelope in month `m`. */
export function sumLeft(state: BookState, m: MonthKey): Minor {
	let total = 0;
	for (const r of state.month(m).envelopes.values()) total += r.left;
	return total;
}

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
	const splitsNet =
		sum(splits.filter((s) => s.term === "FRONTED").map((s) => s.minor)) -
		sum(splits.filter((s) => s.term === "RETURNED").map((s) => s.minor));
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
