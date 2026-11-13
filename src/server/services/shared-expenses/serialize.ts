import { type DecimalInput, toFloat } from "@retrospend/domain/precise-decimal";

/** Decimal columns as numbers, for audit log snapshots. */
export function serializeDecimal(val: unknown): number {
	return toFloat(val as DecimalInput);
}

export function serializeTransaction(tx: Record<string, unknown>) {
	return {
		...tx,
		amount: serializeDecimal(tx.amount),
		splitParticipants: Array.isArray(tx.splitParticipants)
			? tx.splitParticipants.map((sp: Record<string, unknown>) => ({
					...sp,
					shareAmount: serializeDecimal(sp.shareAmount),
					sharePercentage: sp.sharePercentage
						? serializeDecimal(sp.sharePercentage)
						: null,
				}))
			: undefined,
	};
}
