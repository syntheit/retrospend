/**
 * Loaded split and settlement rows to splits replay events (02 §3.3, SPEC
 * §5.8). Pure: splits-input.ts loads the rows, this decides what each one is
 * to your budget, valued once in the book currency H at its booking rate.
 *
 * | Row | Event |
 * |-----|-------|
 * | someone's share of a split you paid (any status: the cash left) | FRONT |
 * | your share of a split someone else paid (not rejected) | OWE |
 * | a payment to you | RECV (counts once FINALIZED, D8) |
 * | a payment from you | PAY (FINALIZED, or recorded or confirmed by you, I5) |
 * | a forgive of what they owe you | FORGIVE, charged to its envelope |
 * | a forgive of what you owe | PAY with no cash: clears your payable |
 *
 * People are keyed by their canonical identity (a claimed shadow is its
 * user), the same rule as People. Rows in a project you count "Not in
 * budget" carry `notInBudget` and the replay lists them without effect.
 * A row whose rate is missing is left out and listed (C18), never valued at 1.
 */
import type { Prisma } from "~prisma";
import { shareUsd, type Valuer } from "./entries";
import type {
	ReplayEvent,
	SettlementStatus,
	ShareStatus,
} from "./splits-replay";
import type { IsoDate, Minor, MonthKey } from "./types";
import { toMinor } from "./units";

export interface PartyRef {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
}

export interface SplitTx {
	id: string;
	currency: string;
	date: Date;
	exchangeRate: Prisma.Decimal | null;
	projectId: string | null;
	paidByType: PartyRef["participantType"];
	paidById: string;
}

/** A participant row of a split you paid or are on. */
export interface SplitPart extends PartyRef {
	id: string;
	shareAmount: Prisma.Decimal;
	verificationStatus: string;
	transaction: SplitTx;
}

export interface SettlementRowIn {
	id: string;
	fromParticipantType: PartyRef["participantType"];
	fromParticipantId: string;
	toParticipantType: PartyRef["participantType"];
	toParticipantId: string;
	amount: Prisma.Decimal;
	currency: string;
	convertedAmount: Prisma.Decimal | null;
	convertedCurrency: string | null;
	status: "PROPOSED" | "CONFIRMED" | "FINALIZED" | "REJECTED";
	kind: "PAYMENT" | "FORGIVE";
	isOffset: boolean;
	confirmedByPayer: boolean;
	confirmedByPayee: boolean;
	settledAt: Date | null;
	initiatedAt: Date;
	projectId: string | null;
	forgiveEnvelopeId: string | null;
	payment: { paidOn: Date } | null;
}

export interface SplitRows {
	/** Others' shares on splits you paid. */
	fronts: readonly SplitPart[];
	/** Your own non-rejected shares (the budget's share definition). */
	mine: readonly SplitPart[];
	settlements: readonly SettlementRowIn[];
}

export interface SplitContext {
	valuer: Valuer;
	/** Canonical key of a participant (claimed shadows are their user). */
	key: (ref: PartyRef) => string;
	me: string;
	/** Projects you count "Not in budget". */
	notInBudget: ReadonlySet<string>;
	/** The stored rate of `currency` on `date` (units per USD; crypto USD per coin), or null. */
	rate: (row: {
		currency: string;
		date: Date;
		exchangeRate: Prisma.Decimal | null;
	}) => string | null;
}

/** A payment to you that has not counted yet (D8): shown as pending, valued. */
export interface PendingReceipt {
	id: string;
	counterparty: string;
	currency: string;
	native: Minor;
	/** Book value of the cash, or null when its rate is missing. */
	cash: Minor | null;
	date: IsoDate;
}

export interface SplitEvents {
	events: ReplayEvent[];
	pending: PendingReceipt[];
}

const shareStatus = (s: string): ShareStatus =>
	s === "ACCEPTED" || s === "AUTO_ACCEPTED" || s === "REJECTED" ? s : "PENDING";

/** Book value of a decimal amount in `currency` on `at`, or null with the missing rate listed. */
function bookValue(
	ctx: SplitContext,
	id: string,
	amount: Prisma.Decimal,
	currency: string,
	at: { date: IsoDate; month: MonthKey; instant: Date },
	storedRate: Prisma.Decimal | null,
): Minor | null {
	const rate = ctx.rate({
		currency,
		date: at.instant,
		exchangeRate: storedRate,
	});
	return ctx.valuer.value(
		{ id, amount, currency, amountInUSD: shareUsd(amount, rate, currency) },
		at.date,
		at.month,
	);
}

function txEvents(ctx: SplitContext, rows: SplitRows): ReplayEvent[] {
	const out: ReplayEvent[] = [];
	for (const p of rows.fronts) {
		const t = p.transaction;
		const counterparty = ctx.key(p);
		if (counterparty === ctx.me) continue;
		const native = toMinor(p.shareAmount.toString(), t.currency);
		if (native <= 0) continue;
		const at = { ...ctx.valuer.dated(t.date), instant: t.date };
		const value = bookValue(
			ctx,
			p.id,
			p.shareAmount,
			t.currency,
			at,
			t.exchangeRate,
		);
		if (value === null) continue;
		out.push({
			kind: "FRONT",
			id: p.id,
			counterparty,
			currency: t.currency,
			...at,
			native,
			value,
			shareStatus: shareStatus(p.verificationStatus),
			notInBudget: t.projectId !== null && ctx.notInBudget.has(t.projectId),
		});
	}
	for (const p of rows.mine) {
		const t = p.transaction;
		const counterparty = ctx.key({
			participantType: t.paidByType,
			participantId: t.paidById,
		});
		if (counterparty === ctx.me) continue;
		const native = toMinor(p.shareAmount.toString(), t.currency);
		if (native <= 0) continue;
		const { date, month } = ctx.valuer.dated(t.date);
		out.push({
			kind: "OWE",
			id: p.id,
			counterparty,
			currency: t.currency,
			date,
			month,
			native,
			status: shareStatus(p.verificationStatus),
			notInBudget: t.projectId !== null && ctx.notInBudget.has(t.projectId),
		});
	}
	return out;
}

/** The day the money moved: the payment's date as entered, else when it settled or started. */
function settledOn(ctx: SplitContext, s: SettlementRowIn) {
	if (s.payment) {
		// paidOn is a calendar date (@db.Date): read it as stored, never re-zoned.
		const date = s.payment.paidOn.toISOString().slice(0, 10);
		return { date, month: ctx.valuer.monthOf(date), instant: s.payment.paidOn };
	}
	const instant = s.settledAt ?? s.initiatedAt;
	return { ...ctx.valuer.dated(instant), instant };
}

const settled = (s: SettlementRowIn): SettlementStatus =>
	s.status === "FINALIZED" ? "FINALIZED" : "PROPOSED";

function settlementEvent(
	ctx: SplitContext,
	s: SettlementRowIn,
	pending: PendingReceipt[],
): ReplayEvent | null {
	if (s.status === "REJECTED") return null;
	const from = ctx.key({
		participantType: s.fromParticipantType,
		participantId: s.fromParticipantId,
	});
	const to = ctx.key({
		participantType: s.toParticipantType,
		participantId: s.toParticipantId,
	});
	const toMe = to === ctx.me;
	if (toMe === (from === ctx.me)) return null;
	const native = toMinor(s.amount.toString(), s.currency);
	if (native <= 0) return null;
	const at = settledOn(ctx, s);
	const base = {
		id: s.id,
		counterparty: toMe ? from : to,
		currency: s.currency,
		date: at.date,
		month: at.month,
		native,
		notInBudget: s.projectId !== null && ctx.notInBudget.has(s.projectId),
	};
	if (s.kind === "FORGIVE") {
		if (toMe)
			return {
				...base,
				kind: "FORGIVE",
				status: settled(s),
				envelopeId: s.forgiveEnvelopeId,
			};
		// They let your debt go: it clears what you owe and no cash moves.
		return {
			...base,
			kind: "PAY",
			status: settled(s),
			cash: 0,
			isOffset: true,
		};
	}
	const paid =
		s.convertedAmount !== null && s.convertedCurrency !== null
			? { amount: s.convertedAmount, currency: s.convertedCurrency }
			: { amount: s.amount, currency: s.currency };
	const cash = s.isOffset
		? 0
		: bookValue(ctx, s.id, paid.amount, paid.currency, at, null);
	if (toMe) {
		if (s.status !== "FINALIZED") {
			pending.push({
				id: s.id,
				counterparty: base.counterparty,
				currency: s.currency,
				native,
				cash,
				date: at.date,
			});
			return null;
		}
		return cash === null
			? null
			: {
					...base,
					kind: "RECV",
					status: "FINALIZED",
					cash,
					isOffset: s.isOffset,
				};
	}
	// A payment you made counts once you recorded or confirmed it (I5).
	if (s.status !== "FINALIZED" && !s.confirmedByPayer) return null;
	return cash === null
		? null
		: { ...base, kind: "PAY", status: settled(s), cash, isOffset: s.isOffset };
}

/** Every split and settlement row as a replay event, plus payments to you still pending. */
export function splitEvents(rows: SplitRows, ctx: SplitContext): SplitEvents {
	const pending: PendingReceipt[] = [];
	const events = txEvents(ctx, rows);
	for (const s of rows.settlements) {
		const e = settlementEvent(ctx, s, pending);
		if (e) events.push(e);
	}
	return { events, pending };
}
