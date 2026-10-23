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
 * A month that has closed (MonthClose) carries, returns and sweeps by the
 * leftover rules it closed under (`closedRules`, B7); a month not closed yet
 * uses today's rules, and viewing next month projects the current month's
 * close the same way.
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

export type MoneyInSource =
	| "INCOME"
	| "STARTING_BALANCE"
	| "ADJUSTMENT"
	/** Wealth to To assign (positive) or To assign to Wealth (negative). */
	| "WEALTH";

/** A row that raises (or, for an OUT adjustment, lowers) To assign. Signed. */
export interface MoneyInEntry {
	id: string;
	month: MonthKey;
	minor: Minor;
	source: MoneyInSource;
}

export type ActivitySource =
	| "SPENT"
	| "REFUND"
	| "SHARE"
	| "FORGIVEN"
	/** Out of the envelope to Wealth (negative) or from Wealth into it (positive). */
	| "WEALTH";

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
	/** Splits replay effects. */
	splits: readonly ReplayEffect[];
	/** Leftover rules each closed month closed under (MonthClose snapshots). */
	closedRules?: ReadonlyMap<MonthKey, ReadonlyMap<string, ClosedRule>>;
	/** Category to envelope links each closed month closed with (MonthClose snapshots). */
	closedLinks?: ReadonlyMap<MonthKey, ReadonlyMap<string, string>>;
	/**
	 * Where the pass starts (SPEC §5.13): the state at the end of a closed
	 * month. Months up to it are not computed; rows dated in them are ignored.
	 */
	checkpoint?: EngineCheckpoint | null;
}

/** Running totals of every month up to and including a checkpoint month. */
export type RunningTotals = Omit<MonthTotals, "activity">;

export interface EngineCheckpoint {
	month: MonthKey;
	/** What each envelope carries into the next month (after its close rule). */
	carry: ReadonlyMap<string, Minor>;
	totals: RunningTotals;
}

export interface ClosedRule {
	rule: LeftoverRule;
	sweepToId: string | null;
}

/** The rule an envelope closes under: Monthly envelopes follow theirs; bills, goals and No target carry. */
export function ruleAtClose(e: EngineEnvelope): ClosedRule {
	return e.kind === "MONTHLY"
		? { rule: e.leftoverRule, sweepToId: e.sweepToId }
		: { rule: "CARRY", sweepToId: null };
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
	/** Σ moves to (negative) and from (positive) Wealth: in Activity, never spending. */
	wealth: Minor;
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
	/** Paid after the start toward debts from before it (owner 2026-10-23). */
	oldDebtsPaid: Minor;
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
	/** Paid after the start toward debts from before it (owner 2026-10-23). */
	oldDebtsPaid: Minor;
	splitsNet: Minor;
	total: Minor;
}

export interface BookState {
	startMonth: MonthKey;
	currentMonth: MonthKey;
	/** The first month computed: the book start, or the month after the checkpoint. */
	firstMonth: MonthKey;
	/** Oldest first, firstMonth to max(through, c + 1). */
	months: readonly MonthState[];
	month(key: MonthKey): MonthState;
	toAssign(key: MonthKey): ToAssignTerms;
	/** Running totals through month `key` (checkpoint included). */
	runningTotals(key: MonthKey): RunningTotals;
	/** With `month`, a closed month routes by the links it closed with. */
	envelopeOf(
		entry: Pick<ActivityEntry, "categoryId" | "envelopeId"> & {
			month?: MonthKey;
		},
	): string;
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
		oldDebtsPaid: 0,
	};
}

const RUNNING_KEYS = [
	"moneyIn",
	"assigned",
	"overspent",
	"returned",
	"fronted",
	"returnedByPeople",
	"forgiven",
	"oldDebtsPaid",
] as const satisfies readonly (keyof RunningTotals)[];

export function emptyRunningTotals(): RunningTotals {
	const { activity: _a, ...rest } = emptyTotals();
	return rest;
}

function addRunning(into: RunningTotals, t: RunningTotals) {
	for (const k of RUNNING_KEYS) into[k] += t[k];
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
	// A closed month routes by the links it closed with (B7); open months by today's.
	const linksAt = (month: MonthKey | undefined) => {
		const closed = month === undefined ? undefined : input.closedLinks?.get(month);
		return closed ?? byCategory;
	};
	const envelopeOf = (
		entry: Pick<ActivityEntry, "categoryId" | "envelopeId"> & {
			month?: MonthKey;
		},
	) => {
		if (entry.envelopeId && ids.has(entry.envelopeId)) return entry.envelopeId;
		const linked = entry.categoryId
			? linksAt(entry.month).get(entry.categoryId)
			: undefined;
		return linked && ids.has(linked) ? linked : input.defaultEnvelopeId;
	};
	return { known, envelopeOf, byCategory };
}

/** Forgiven balances are charged to their envelope in the forgive month (§5.8). */
function forgiveCharges(splits: readonly ReplayEffect[]): ActivityEntry[] {
	return splits
		.filter((s) => s.term === "FORGIVEN")
		.map((s) => ({
			id: `forgive:${s.eventId}`,
			month: s.month,
			date: s.date,
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
			wealth: 0,
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
		if (a.source === "WEALTH") r.wealth += a.minor;
		totals.activity += a.minor;
	}
	for (const s of b.splits.get(month) ?? []) {
		if (s.term === "FRONTED") totals.fronted += s.minor;
		else if (s.term === "RETURNED") totals.returnedByPeople += s.minor;
		else if (s.term === "OLD_DEBT_PAID") totals.oldDebtsPaid += s.minor;
		else totals.forgiven += s.minor;
	}
	for (const r of rows.values()) {
		r.left = r.carryIn + r.assigned + r.activity;
		if (r.left < 0) totals.overspent -= r.left;
	}
	return { month, envelopes: rows, totals };
}

/**
 * Leftovers after month k: carry, return or sweep (SPEC §5.5 step 1), by the
 * rules month k closed under when it has closed (B7), else today's.
 */
function close(
	state: MonthState,
	envelopes: readonly EngineEnvelope[],
	totals: MonthTotals,
	snapshot: ReadonlyMap<string, ClosedRule> | undefined,
): Map<string, Minor> {
	const next = new Map<string, Minor>();
	const add = (id: string, v: Minor) => next.set(id, (next.get(id) ?? 0) + v);
	const known = new Set(envelopes.map((e) => e.id));
	for (const e of envelopes) {
		const pos = Math.max(0, state.envelopes.get(e.id)?.left ?? 0);
		const { rule, sweepToId } = snapshot?.get(e.id) ?? ruleAtClose(e);
		if (rule === "CARRY") add(e.id, pos);
		else if (rule === "RETURN") totals.returned += pos;
		// A sweep target archived since keeps the money where it was.
		else add(sweepToId && known.has(sweepToId) ? sweepToId : e.id, pos);
	}
	return next;
}

/** Runs every month from the book start to max(through, c + 1). */
export function computeBook(
	input: EngineInput,
	through: MonthKey = input.currentMonth,
): BookState {
	const last = Math.max(through, addMonths(input.currentMonth, 1));
	const cp = input.checkpoint ?? null;
	if (cp && cp.month >= input.currentMonth)
		throw new EngineInputError("a checkpoint is for a closed month");
	const first = cp ? addMonths(cp.month, 1) : input.startMonth;
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
		if (mv.month < input.startMonth)
			throw new EngineInputError(`movement ${mv.id} is before the book start`);
	}
	const months: MonthState[] = [];
	let carry = new Map<string, Minor>(cp?.carry ?? []);
	for (const key of monthsFrom(first, last)) {
		const state = monthState(key, carry, input, b, route);
		carry = close(
			state,
			input.envelopes,
			state.totals,
			input.closedRules?.get(key),
		);
		months.push(state);
	}
	const index = new Map(months.map((s) => [s.month, s]));
	const month = (key: MonthKey) => {
		const s = index.get(key);
		if (!s) throw new RangeError(`month ${key} is outside the book`);
		return s;
	};
	const base = cp?.totals ?? emptyRunningTotals();
	return {
		startMonth: input.startMonth,
		currentMonth: input.currentMonth,
		firstMonth: first,
		months,
		month,
		toAssign: (key) =>
			toAssignAt(months, input.currentMonth, month(key).month, base),
		runningTotals: (key) => {
			const out = { ...base };
			for (const s of months) if (s.month <= key) addRunning(out, s.totals);
			return out;
		},
		envelopeOf: route.envelopeOf,
	};
}

function toAssignAt(
	months: readonly MonthState[],
	c: MonthKey,
	m: MonthKey,
	base: RunningTotals,
): ToAssignTerms {
	const a = m < c ? m : addMonths(c, 1);
	// Months up to the checkpoint are all before m (it is a closed month).
	const t: ToAssignTerms = {
		moneyIn: base.moneyIn,
		assigned: base.assigned,
		assignedAhead: 0,
		overspendTaken: base.overspent,
		returned: base.returned,
		fronted: base.fronted,
		returnedByPeople: base.returnedByPeople,
		forgiven: base.forgiven,
		oldDebtsPaid: base.oldDebtsPaid,
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
		t.oldDebtsPaid += s.totals.oldDebtsPaid;
		if (s.month < m) {
			t.overspendTaken += s.totals.overspent;
			t.returned += s.totals.returned;
		}
	}
	t.splitsNet = t.fronted - t.returnedByPeople - t.forgiven + t.oldDebtsPaid;
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
