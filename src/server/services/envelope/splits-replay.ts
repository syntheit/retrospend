/**
 * Splits replay (02 §3.3, SPEC §5.8, D18, D8, D10, D12, D20): what money is
 * out with other people, and when it leaves or returns to To assign.
 *
 * Per counterparty and native currency, events run in date order (on one
 * day, splits before the payments that settle them; then by id) over
 * a state `native` (positive = they owe you, negative = you owe them) and
 * `basis` (book value of the positive part, H minor). Each event may emit an
 * effect on SplitsNet = Fronted - Returned - Forgiven:
 *
 * | Event   | Effect |
 * |---------|--------|
 * | FRONT   | pays down what you owe first (no effect); the rest is fronted at its booked value |
 * | OWE     | nets against what they owe you (basis returns); the rest is a payable (no effect) |
 * | UNFRONT | a correction lowered someone's share of a split you paid: clears the receivable (its held value returns); the rest is a payable |
 * | RECV    | FINALIZED only: clears the receivable, cash value returns (FX note = cash - basis); excess is a payable |
 * | PAY     | FINALIZED or PROPOSED: pays the payable (no effect); excess becomes a receivable, its cash value leaves |
 * | FORGIVE | FINALIZED: clears the receivable; its basis is Forgiven and charged to an envelope |
 *
 * Inputs are already valued: `value` and `cash` are H minor units at the
 * booking rate (valuation.ts); `native` is minor units of `currency`.
 */
import type { IsoDate, Minor, MonthKey } from "./types";
import { assertMinor, mulDiv } from "./units";

export type SettlementStatus = "PROPOSED" | "FINALIZED" | "REJECTED";
export type ShareStatus = "PENDING" | "ACCEPTED" | "AUTO_ACCEPTED" | "REJECTED";

interface EventBase {
	id: string;
	counterparty: string;
	currency: string;
	date: IsoDate;
	/** Budget month of the event (the engine maps dates to months). */
	month: MonthKey;
	/** Positive amount in minor units of `currency`. */
	native: Minor;
	/** Project routed "Not in budget" (D11 revised): dropped from the replay. */
	notInBudget?: boolean;
}

interface SettlementLeg {
	status: SettlementStatus;
	/** Book value of the settlement leg (cash received or paid). */
	cash: Minor;
	/** Offset rows move no cash: a RECV releases at basis. */
	isOffset?: boolean;
}

export type ReplayEvent =
	| (EventBase & {
			kind: "FRONT";
			/** Book value of `native` at the expense's booking rate. */
			value: Minor;
			/** Informational: a REJECTED share is still fronted, the cash left. */
			shareStatus?: ShareStatus;
	  })
	| (EventBase & { kind: "OWE"; status: ShareStatus })
	| (EventBase & { kind: "UNFRONT" })
	| (EventBase & SettlementLeg & { kind: "RECV" })
	| (EventBase &
			SettlementLeg & {
				kind: "PAY";
				/** They let your debt go: it clears what you owe, never more. */
				forgiven?: boolean;
			})
	| (EventBase & {
			kind: "FORGIVE";
			status: SettlementStatus;
			/** Null: charged to "Everything else" (the envelope was deleted). */
			envelopeId: string | null;
	  });

/**
 * OLD_DEBT_PAID: cash you paid, after the budget started, toward a debt you
 * owed from before it (owner decision 2026-10-23): it leaves To assign like
 * any payment. A pre-start receivable needs no term: what you receive for it
 * counts when it arrives (RETURNED), since its fronting was never counted.
 */
export type SplitsTerm = "FRONTED" | "RETURNED" | "FORGIVEN" | "OLD_DEBT_PAID";

export interface ReplayEffect {
	eventId: string;
	date: IsoDate;
	month: MonthKey;
	counterparty: string;
	currency: string;
	term: SplitsTerm;
	/** Positive H minor units. */
	minor: Minor;
	/** RETURNED only: cash value minus basis released (D10 note). */
	fx: Minor;
	/** FORGIVEN only: the envelope charged in the forgive month. */
	envelopeId?: string | null;
}

export interface ReplayBalance {
	counterparty: string;
	currency: string;
	/** Positive = they owe you, negative = you owe them. */
	native: Minor;
	/** Book value of what they owe you (0 when native <= 0). */
	basis: Minor;
	/** Date of the oldest part still owed to you, first in first out (aging, C15). */
	oldestOpen: IsoDate | null;
}

export type IgnoredReason =
	| "NOT_IN_BUDGET"
	| "REJECTED"
	| "PENDING_NOT_COUNTED"
	| "FORGIVE_EXCEEDS_BALANCE";

export interface ReplayResult {
	effects: ReplayEffect[];
	balances: ReplayBalance[];
	/** Events that changed nothing, with why; PROPOSED receipts show as pending in explain. */
	ignored: Array<{ eventId: string; reason: IgnoredReason; native: Minor }>;
}

interface State {
	native: Minor;
	basis: Minor;
	/** The part of what you owe that started before the budget did. */
	oldPayable: Minor;
	/** The part owed to you from before the budget: never fronted in it. */
	oldReceivable: Minor;
	/** What they owe you, by the date each part started, oldest first. */
	lots: Array<{ date: IsoDate; native: Minor }>;
}

function addLot(s: State, date: IsoDate, native: Minor) {
	s.lots.push({ date, native });
}

function consumeLots(s: State, native: Minor) {
	let left = native;
	while (left > 0 && s.lots.length > 0) {
		const lot = s.lots[0] as { date: IsoDate; native: Minor };
		const take = Math.min(left, lot.native);
		lot.native -= take;
		left -= take;
		if (lot.native === 0) s.lots.shift();
	}
}

type Emit = (
	term: SplitsTerm,
	minor: Minor,
	extra?: Partial<ReplayEffect>,
) => void;
type Ignore = (reason: IgnoredReason, native: Minor) => void;

/** `total` scaled by part / whole; the whole takes all of it (no rounding dust). */
function portion(total: Minor, part: Minor, whole: Minor): Minor {
	return part === whole ? total : mulDiv(total, part, whole);
}

/** Clears up to `n` of a positive balance, returning the native and basis cleared. */
function clearReceivable(
	s: State,
	n: Minor,
): { cleared: Minor; released: Minor; oldCleared: Minor } {
	const cleared = Math.min(n, Math.max(s.native, 0));
	if (cleared === 0) return { cleared: 0, released: 0, oldCleared: 0 };
	const released = portion(s.basis, cleared, s.native);
	s.native -= cleared;
	s.basis -= released;
	consumeLots(s, cleared);
	// Oldest first: what was owed from before the start clears first.
	const oldCleared = Math.min(cleared, s.oldReceivable);
	s.oldReceivable -= oldCleared;
	return { cleared, released, oldCleared };
}

/** Pays down up to `n` of a negative balance; returns what is left of `n`. */
function payDownPayable(s: State, n: Minor): Minor {
	const down = Math.min(n, Math.max(-s.native, 0));
	s.native += down;
	return n - down;
}

function applyFront(
	s: State,
	e: Extract<ReplayEvent, { kind: "FRONT" }>,
	emit: Emit,
) {
	const rest = payDownPayable(s, e.native);
	if (rest === 0) return;
	const value = portion(e.value, rest, e.native);
	s.native += rest;
	s.basis += value;
	addLot(s, e.date, rest);
	emit("FRONTED", value);
}

/**
 * A correction lowered their share of a split you paid (2C.2): less is out
 * with them, so the held value comes back like a forgive's, except that a
 * part from before the budget started was never held and returns nothing.
 * What they had already paid is now owed back to them (a payable). The
 * mirror case, a correction lowering your own share of a split they paid,
 * is a FRONT: it pays down what you owe and fronts the rest.
 */
function applyUnfront(
	s: State,
	e: Extract<ReplayEvent, { kind: "UNFRONT" }>,
	emit: Emit,
) {
	const { cleared, released, oldCleared } = clearReceivable(s, e.native);
	const counted = released - portion(released, oldCleared, cleared);
	if (counted > 0) emit("RETURNED", counted);
	s.native -= e.native - cleared;
}

function applyOwe(
	s: State,
	e: Extract<ReplayEvent, { kind: "OWE" }>,
	emit: Emit,
	ignore: Ignore,
) {
	if (e.status === "REJECTED") return ignore("REJECTED", e.native);
	const { cleared, released } = clearReceivable(s, e.native);
	if (cleared > 0) emit("RETURNED", released);
	s.native -= e.native - cleared;
}

function applyRecv(
	s: State,
	e: Extract<ReplayEvent, { kind: "RECV" }>,
	emit: Emit,
	ignore: Ignore,
) {
	if (e.status === "REJECTED") return ignore("REJECTED", e.native);
	if (e.status !== "FINALIZED") return ignore("PENDING_NOT_COUNTED", e.native);
	const { cleared, released } = clearReceivable(s, e.native);
	if (cleared > 0) {
		const cash = e.isOffset ? released : portion(e.cash, cleared, e.native);
		emit("RETURNED", cash, { fx: cash - released });
	}
	s.native -= e.native - cleared;
}

function applyPay(
	s: State,
	e: Extract<ReplayEvent, { kind: "PAY" }>,
	emit: Emit,
	ignore: Ignore,
) {
	if (e.status === "REJECTED") return ignore("REJECTED", e.native);
	const excess = payDownPayable(s, e.native);
	if (excess === 0) return;
	// Forgiving more than you owed creates nothing they owe you: dropped.
	if (e.forgiven) return ignore("FORGIVE_EXCEEDS_BALANCE", excess);
	const value = portion(e.cash, excess, e.native);
	s.native += excess;
	s.basis += value;
	addLot(s, e.date, excess);
	emit("FRONTED", value);
}

function applyForgive(
	s: State,
	e: Extract<ReplayEvent, { kind: "FORGIVE" }>,
	emit: Emit,
	ignore: Ignore,
) {
	if (e.status === "REJECTED") return ignore("REJECTED", e.native);
	if (e.status !== "FINALIZED") return ignore("PENDING_NOT_COUNTED", e.native);
	const { cleared, released, oldCleared } = clearReceivable(s, e.native);
	// A part owed from before the start was never fronted in the budget:
	// letting it go moves nothing and charges no envelope.
	const counted = released - portion(released, oldCleared, cleared);
	if (counted > 0) emit("FORGIVEN", counted, { envelopeId: e.envelopeId });
	if (e.native > cleared) ignore("FORGIVE_EXCEEDS_BALANCE", e.native - cleared);
}

/** On one day, splits come before the payments and forgives that settle them. */
const PHASE: Record<ReplayEvent["kind"], number> = {
	FRONT: 0,
	OWE: 0,
	UNFRONT: 0,
	RECV: 1,
	PAY: 1,
	FORGIVE: 1,
};

/**
 * After a FRONT or PAY in the budget: the part that paid down a debt from
 * before the start left your cash, so it leaves To assign (OLD_DEBT_PAID) at
 * the event's value. A forgive or an offset moves no cash: nothing leaves.
 */
function paidOldDebt(s: State, e: ReplayEvent, owedBefore: Minor, emit: Emit) {
	if (s.oldPayable === 0 || (e.kind !== "FRONT" && e.kind !== "PAY")) return;
	const down = Math.min(e.native, owedBefore);
	const old = Math.min(down, s.oldPayable);
	if (old <= 0) return;
	s.oldPayable -= old;
	const total = e.kind === "FRONT" ? e.value : e.isOffset ? 0 : e.cash;
	const value = portion(total, old, e.native);
	if (value > 0) emit("OLD_DEBT_PAID", value);
}

function byDateThenId(a: ReplayEvent, b: ReplayEvent): number {
	if (a.date !== b.date) return a.date < b.date ? -1 : 1;
	if (PHASE[a.kind] !== PHASE[b.kind]) return PHASE[a.kind] - PHASE[b.kind];
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function applyEvent(s: State, e: ReplayEvent, emit: Emit, ignore: Ignore) {
	assertMinor(e.native, "native amount");
	if (e.native <= 0)
		throw new RangeError(`event ${e.id}: native must be positive`);
	if (e.kind === "FRONT") applyFront(s, e, emit);
	else if (e.kind === "OWE") applyOwe(s, e, emit, ignore);
	else if (e.kind === "UNFRONT") applyUnfront(s, e, emit);
	else if (e.kind === "RECV") applyRecv(s, e, emit, ignore);
	else if (e.kind === "PAY") applyPay(s, e, emit, ignore);
	else applyForgive(s, e, emit, ignore);
}

/** Replays every split and settlement event into SplitsNet effects (02 §3.3). */
export function replaySplits(
	events: readonly ReplayEvent[],
	opts: { startMonth?: MonthKey } = {},
): ReplayResult {
	const states = new Map<
		string,
		State & { counterparty: string; currency: string }
	>();
	const result: ReplayResult = { effects: [], balances: [], ignored: [] };
	for (const e of [...events].sort(byDateThenId)) {
		if (e.notInBudget) {
			result.ignored.push({
				eventId: e.id,
				reason: "NOT_IN_BUDGET",
				native: e.native,
			});
			continue;
		}
		const key = `${e.counterparty}\u0000${e.currency}`;
		const s = states.get(key) ?? {
			native: 0,
			basis: 0,
			oldPayable: 0,
			oldReceivable: 0,
			lots: [],
			counterparty: e.counterparty,
			currency: e.currency,
		};
		states.set(key, s);
		const emit: Emit = (term, minor, extra) => {
			const base = {
				eventId: e.id,
				date: e.date,
				month: e.month,
				counterparty: e.counterparty,
			};
			result.effects.push({
				...base,
				currency: e.currency,
				term,
				minor,
				fx: 0,
				...extra,
			});
		};
		const ignore: Ignore = (reason, native) => {
			result.ignored.push({ eventId: e.id, reason, native });
		};
		const owedBefore = Math.max(0, -s.native);
		applyEvent(s, e, emit, ignore);
		if (opts.startMonth !== undefined && e.month < opts.startMonth) {
			// Everything owed at the start is the starting position's.
			s.oldPayable = Math.max(0, -s.native);
			s.oldReceivable = Math.max(0, s.native);
		} else {
			paidOldDebt(s, e, owedBefore, emit);
		}
	}
	for (const s of states.values()) {
		result.balances.push({
			counterparty: s.counterparty,
			currency: s.currency,
			native: s.native,
			basis: s.basis,
			oldestOpen: s.native > 0 ? (s.lots[0]?.date ?? null) : null,
		});
	}
	return result;
}

export interface SplitsTotals {
	fronted: Minor;
	returned: Minor;
	forgiven: Minor;
	/** Paid toward debts from before the budget started. */
	oldDebtsPaid: Minor;
	/** SplitsNet = fronted - returned - forgiven + oldDebtsPaid; it lowers To assign. */
	net: Minor;
	/** Σ FX notes on returned cash (informational). */
	fx: Minor;
}

/** SplitsNet(<= month) and its terms; all months when `through` is omitted. */
export function splitsTotals(
	effects: readonly ReplayEffect[],
	through?: MonthKey,
): SplitsTotals {
	const t = {
		fronted: 0,
		returned: 0,
		forgiven: 0,
		oldDebtsPaid: 0,
		net: 0,
		fx: 0,
	};
	for (const e of effects) {
		if (through !== undefined && e.month > through) continue;
		if (e.term === "FRONTED") t.fronted += e.minor;
		else if (e.term === "RETURNED") t.returned += e.minor;
		else if (e.term === "OLD_DEBT_PAID") t.oldDebtsPaid += e.minor;
		else t.forgiven += e.minor;
		t.fx += e.fx;
	}
	t.net = t.fronted - t.returned - t.forgiven + t.oldDebtsPaid;
	return t;
}
