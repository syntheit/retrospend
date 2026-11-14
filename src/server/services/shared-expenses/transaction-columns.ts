/**
 * What a shared expense's writer hands Postgres for the numbers it still
 * receives: decimal text at each column's scale, half to even (money-dec
 * columnText). Amount and shares are DECIMAL(19,8), the rate (18,6) and
 * a percentage (7,4).
 */
import { columnText } from "@retrospend/domain/money-dec";
import { type DecimalInput, toFloat } from "@retrospend/domain/precise-decimal";
import type { Prisma } from "~prisma";

export const amountColumn = (amount: DecimalInput) => columnText(amount, 8);

export const rateColumn = (rate: DecimalInput | null | undefined) =>
	rate === null || rate === undefined ? null : columnText(rate, 6);

/** A split row's share, and its percentage when it has one. */
export const shareColumns = (p: {
	shareAmount?: DecimalInput;
	sharePercentage?: DecimalInput | null;
}) => ({
	shareAmount: columnText(p.shareAmount!, 8),
	sharePercentage:
		p.sharePercentage === undefined || p.sharePercentage === null
			? null
			: columnText(p.sharePercentage, 4),
});

/**
 * Whether an edit's diff touches what a participant agreed to pay. Only then
 * do the other participants answer again; a title, category, note or receipt
 * edit keeps every answer.
 */
export const changesMoney = (diff: object) =>
	[
		"amount",
		"currency",
		"date",
		"paidBy",
		"projectId",
		"splitMode",
		"splitParticipants",
	].some((field) => field in diff);

/** An update's columns: its numbers go to Prisma as decimal text. */
export function columnsOf<
	T extends { amount?: number; exchangeRate?: number | null },
>(fields: T): Prisma.SharedTransactionUncheckedUpdateInput {
	const { amount, exchangeRate, ...rest } = fields;
	return {
		...rest,
		...(amount === undefined ? {} : { amount: amountColumn(amount) }),
		...(exchangeRate === undefined
			? {}
			: { exchangeRate: rateColumn(exchangeRate) }),
	} as Prisma.SharedTransactionUncheckedUpdateInput;
}

/** A split row as the service holds it: stored shares are Decimals, kept whole. */
export interface SplitRow {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
	shareAmount?: DecimalInput;
	sharePercentage?: DecimalInput;
	shareUnits?: number;
}

/** The split engine takes numbers: this is its input edge. */
export const engineInput = (
	amount: DecimalInput,
	participants: readonly SplitRow[],
) => ({
	amount: toFloat(amount),
	participants: participants.map((p) => ({
		...p,
		shareAmount:
			p.shareAmount === undefined ? undefined : toFloat(p.shareAmount),
		sharePercentage:
			p.sharePercentage === undefined ? undefined : toFloat(p.sharePercentage),
	})),
});
