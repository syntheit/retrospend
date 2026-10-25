import type { RetrospendClient } from "@retrospend/api-client";
import { fromMinor, type Money } from "@retrospend/domain/money-minor";
import type { PersonRef, SettleContext } from "@/features/people/source";

export type RecordInput = Parameters<RetrospendClient["payments"]["record"]>[0];
export type PaymentPreview = Awaited<
	ReturnType<RetrospendClient["payments"]["previewRecord"]>
>;
export type Direction = SettleContext["direction"];

/** What the person settles: all of it, or one currency's part of it. */
export type AmountChoice =
	| { kind: "everything" }
	| { kind: "part"; currency: string };

/**
 * The body of POST /payments, and of its preview twin: the preview is a dry
 * run of exactly this write. "Everything" sends no amount (the server pays
 * all that is owed); a part sends that part's amount in the payment
 * currency and applies it to that currency's debts.
 */
export function recordInput(
	person: PersonRef,
	context: SettleContext,
	direction: Direction,
	choice: AmountChoice,
	id: string,
): RecordInput {
	const base = { id, person, direction, currency: context.currency };
	if (choice.kind === "everything") return { ...base, amount: null };
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
 * What the payment pays, in the payment currency: the allocation the server
 * answers with in the preview's detail (the same one the write returns).
 */
export function allocationAmount(preview: PaymentPreview): Money | null {
	const detail = preview.detail as
		| { allocation?: { amount: Money } | null }
		| undefined;
	return detail?.allocation?.amount ?? null;
}
