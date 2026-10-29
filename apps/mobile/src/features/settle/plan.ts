import type { RetrospendClient } from "@retrospend/api-client";
import { fromMinor, type Money } from "@retrospend/domain/money-minor";
import type { PersonRef, SettleContext } from "@/features/people/source";

export type RecordInput = Parameters<RetrospendClient["payments"]["record"]>[0];
export type PaymentPreview = Awaited<
	ReturnType<RetrospendClient["payments"]["previewRecord"]>
>;
export type Direction = SettleContext["direction"];

/**
 * What the person settles: all of it, one currency's part of it, or an
 * amount typed on the keypad (in the payment currency; `minor` is 0 until a
 * valid amount is typed).
 */
export type AmountChoice =
	| { kind: "everything" }
	| { kind: "part"; currency: string }
	| { kind: "custom"; minor: number };

/**
 * What the person picked besides the amount: the rate type a conversion
 * uses, how they paid and on which day. Left null, the server's defaults
 * stand (its reference rate, no method, today).
 */
export interface RecordDetails {
	rateType?: string | null;
	paymentMethod?: string | null;
	paidOn?: string | null;
}

/**
 * The body of POST /payments, and of its preview twin: the preview is a dry
 * run of exactly this write. "Everything" sends no amount (the server pays
 * all that is owed); a part sends that part's amount in the payment
 * currency and applies it to that currency's debts; a custom amount sends
 * what was typed and the server allocates it. A half-typed custom amount is
 * null, so nothing is previewed or recorded for it.
 */
export function recordInput(
	person: PersonRef,
	context: SettleContext,
	direction: Direction,
	choice: AmountChoice,
	id: string,
	details: RecordDetails = {},
): RecordInput | null {
	const base = {
		id,
		person,
		direction,
		currency: context.currency,
		...(details.rateType ? { rateType: details.rateType } : {}),
		...(details.paymentMethod ? { paymentMethod: details.paymentMethod } : {}),
		...(details.paidOn ? { paidOn: details.paidOn } : {}),
	};
	if (choice.kind === "everything") return { ...base, amount: null };
	if (choice.kind === "custom") {
		if (choice.minor <= 0) return null;
		return {
			...base,
			amount: fromMinor({ minor: choice.minor, currency: context.currency }),
		};
	}
	const part = context.parts.find((p) => p.currency === choice.currency);
	if (!part) throw new RangeError(`No ${choice.currency} part to settle`);
	return {
		...base,
		amount: fromMinor(part.full),
		applyTo: [{ currency: choice.currency }],
	};
}

/** The figures a payment preview names, and which of them the sheet words. */
export const SETTLE_FIGURES = [
	"balance.person",
	"owed.owedToYou",
	"owed.youOwe",
] as const;
export type SettleFigure = (typeof SETTLE_FIGURES)[number];

export interface ChangeRow {
	figure: SettleFigure;
	currency: string;
	before: Money | null;
	after: Money | null;
	/** A converted total: its amounts are estimates, shown with "≈". */
	approx: boolean;
}

export interface KeptRow {
	figure: SettleFigure;
	lines: Money[];
	approx: boolean;
}

function isFigure(id: string): id is SettleFigure {
	return (SETTLE_FIGURES as readonly string[]).includes(id);
}

/** A figure line as money; a percent line is not money and is left out. */
function asMoney(
	line: { minor: number; currency: string } | null,
): Money | null {
	return line && line.currency !== "%" ? line : null;
}

/**
 * What the preview says will change and what will not, for the figures the
 * sheet words. The server decides the numbers; this only picks and orders.
 */
export function previewRows(preview: PaymentPreview): {
	changes: ChangeRow[];
	kept: KeptRow[];
} {
	const changes = preview.changes.flatMap((change) =>
		isFigure(change.id)
			? [
					{
						figure: change.id,
						currency: change.currency,
						before: asMoney(change.before),
						after: asMoney(change.after),
						approx: change.approx === true,
					},
				]
			: [],
	);
	const kept = preview.unchanged.flatMap((item) =>
		isFigure(item.id)
			? [
					{
						figure: item.id,
						lines: item.lines.flatMap((line) => asMoney(line) ?? []),
						approx: item.approx === true,
					},
				]
			: [],
	);
	return { changes, kept };
}

/**
 * What the payment pays, in the payment currency, from the allocation the
 * server answers with in the preview's detail (the same one the write
 * returns). `converted` is true when a debt in another currency was turned
 * into the payment currency at a rate, so the amount is an estimate.
 */
export function allocationOf(
	preview: PaymentPreview,
): { amount: Money; converted: boolean } | null {
	const detail = preview.detail as
		| {
				allocation?: {
					amount: Money;
					rows?: { rate: unknown | null }[];
				} | null;
		  }
		| undefined;
	const allocation = detail?.allocation;
	if (!allocation) return null;
	return {
		amount: allocation.amount,
		converted: (allocation.rows ?? []).some((row) => row.rate !== null),
	};
}

/** Which way a signed line points: they owe you (incoming) or you owe them. */
function pointsTheWay(minor: number, direction: Direction): boolean {
	return direction === "incoming" ? minor > 0 : minor < 0;
}

/**
 * The open balances the chosen direction settles, one amount per line as
 * the server sends them (never added together), without their sign. Empty
 * when the one line is already in the payment currency: Everything says it.
 */
export function owedBreakdown(
	context: SettleContext,
	direction: Direction,
): Money[] {
	const lines = context.lines
		.filter((line) => pointsTheWay(line.amount.minor, direction))
		.map((line) => ({
			minor: Math.abs(line.amount.minor),
			currency: line.amount.currency,
		}));
	if (lines.length === 1 && lines[0]?.currency === context.currency) return [];
	return lines;
}

/** Everything is an estimate when a debt in another currency turns into the payment currency. */
export function everythingConverts(
	context: SettleContext,
	direction: Direction,
): boolean {
	return context.lines.some(
		(line) =>
			pointsTheWay(line.amount.minor, direction) &&
			line.amount.currency !== context.currency,
	);
}

/** What a payment pays and cancels, as the server's dry run answers it. */
export interface Allocation {
	amount: Money;
	/** Everything owed, in the payment currency. */
	full: Money;
	rows: { pays: Money; paid: Money; excess: boolean }[];
	offsets: { cancels: Money; value: Money }[];
	/** More than everything owed; null when it is not. */
	overpay: Money | null;
}

/** The allocation in a preview's detail; null when the server sent none. */
export function allocationDetail(preview: PaymentPreview): Allocation | null {
	const detail = preview.detail as
		| { allocation?: Allocation | null }
		| undefined;
	return detail?.allocation ?? null;
}

export interface RateChoices {
	/** The debt currencies that turn into the payment currency. */
	currencies: string[];
	/** The rate types the server has, when there is a choice between them. */
	types: string[];
	/** The type the conversion uses now. */
	current: string | null;
	/** What one unit of each debt currency is worth in the payment currency. */
	rates: { currency: string; unit: Money; value: Money; type: string }[];
}

/**
 * The rate chips of a conversion (GUIDELINE 7, as the web's Rates): there
 * only when the payment turns a debt in another currency into the payment
 * currency, with the rate each of them uses now. Null when nothing converts.
 */
export function rateChoices(
	context: SettleContext,
	allocation: Allocation | null,
	picked: string | null,
): RateChoices | null {
	if (!allocation) return null;
	const pay = allocation.amount.currency;
	const currencies = [
		...new Set([
			...allocation.rows
				.filter((row) => !row.excess && row.pays.currency !== pay)
				.map((row) => row.pays.currency),
			...allocation.offsets
				.filter((offset) => offset.cancels.currency !== pay)
				.map((offset) => offset.cancels.currency),
		]),
	];
	if (currencies.length === 0) return null;
	const rates = currencies.flatMap((currency) => {
		const rate = context.rates.find((r) => r.currency === currency)?.rate;
		return rate
			? [{ currency, unit: rate.unit, value: rate.value, type: rate.type }]
			: [];
	});
	return {
		currencies,
		types: context.rateTypes.length > 1 ? [...context.rateTypes] : [],
		current: picked ?? rates[0]?.type ?? null,
		rates,
	};
}

/**
 * The balance with the person once this payment is recorded, from the
 * preview: each currency that still has something open, signed from your
 * side (positive: they owe you). Empty when the payment settles everything.
 */
export function balanceAfter(preview: PaymentPreview): Money[] {
	const changed = preview.changes.filter(
		(change) => change.id === "balance.person",
	);
	const changedCurrencies = new Set(changed.map((change) => change.currency));
	const stays = preview.unchanged.flatMap((item) =>
		item.id === "balance.person"
			? item.lines.filter((line) => !changedCurrencies.has(line.currency))
			: [],
	);
	return [
		...changed.flatMap((change) => asMoney(change.after) ?? []),
		...stays.flatMap((line) => asMoney(line) ?? []),
	].filter((line) => line.minor !== 0);
}

/** The problem the server answers for an amount above everything owed. */
export function isOverpay(error: unknown): boolean {
	return (error as { code?: string } | null)?.code === "overpay";
}

/**
 * A dry run answers one request. It is shown, and recorded, only for the
 * request it was made for; after any change to the request it is gone until
 * the new one answers.
 */
export function answerFor<T extends { key: string }>(
	answer: T | null,
	key: string | null,
): T | null {
	return answer !== null && key !== null && answer.key === key ? answer : null;
}
