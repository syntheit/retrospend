/**
 * What a shared expense's writer hands Postgres for the numbers it still
 * receives: decimal text at each column's scale, half to even (money-dec
 * columnFromFloat). Amount and shares are DECIMAL(19,8), the rate (18,6) and
 * a percentage (7,4).
 */
import { columnFromFloat } from "@retrospend/domain/money-dec";
import type { Prisma } from "~prisma";

export const amountColumn = (amount: number) => columnFromFloat(amount, 8);

export const rateColumn = (rate: number | null | undefined) =>
	rate === null || rate === undefined ? null : columnFromFloat(rate, 6);

/** A split row's share, and its percentage when it has one. */
export const shareColumns = (p: {
	shareAmount?: number;
	sharePercentage?: number | null;
}) => ({
	shareAmount: columnFromFloat(p.shareAmount!, 8),
	sharePercentage:
		p.sharePercentage === undefined || p.sharePercentage === null
			? null
			: columnFromFloat(p.sharePercentage, 4),
});

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
