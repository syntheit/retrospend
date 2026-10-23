/** Decimal columns as numbers, for audit log snapshots. */
export function serializeDecimal(val: unknown): number {
	if (val && typeof val === "object" && "toNumber" in val) {
		return (val as { toNumber(): number }).toNumber();
	}
	return Number(val);
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
