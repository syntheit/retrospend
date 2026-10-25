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
): RecordInput | null {
	const base = { id, person, direction, currency: context.currency };
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
}

export interface KeptRow {
	figure: SettleFigure;
	lines: Money[];
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
): { amount: Money; converted: boolean; overpay: Money | null } | null {
	const detail = preview.detail as
		| {
				allocation?: {
					amount: Money;
					rows?: { rate: unknown | null }[];
					overpay?: Money | null;
				} | null;
		  }
		| undefined;
	const allocation = detail?.allocation;
	if (!allocation) return null;
	return {
		amount: allocation.amount,
		converted: (allocation.rows ?? []).some((row) => row.rate !== null),
		overpay: allocation.overpay ?? null,
	};
}
