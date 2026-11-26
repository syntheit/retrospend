import type { WriteOp } from "@retrospend/engine/device";

// What the device books for a person's confirm or skip of one due period: the
// one place that builds the engine's op from a sheet's body or a parked
// entry's payload (the sheets and Try again both read it).

export type SettleKind = "confirm" | "skip";

/** The request body of the sheets' dry run and write. */
export interface SettleInput {
	id: string;
	dueAt: string;
	amount?: string;
	paidOn?: string;
}

/** `expenseId` is the id the posted expense takes: the outbox entry's client id. */
export function settleOpOf(
	kind: SettleKind,
	input: SettleInput,
	expenseId: string,
): Extract<WriteOp, { kind: "confirm" | "skip" }> {
	const base = { templateId: input.id, dueAt: input.dueAt };
	return kind === "skip"
		? { kind, body: base }
		: {
				kind,
				body: {
					...base,
					expenseId,
					...(input.amount !== undefined ? { amount: input.amount } : {}),
					...(input.paidOn !== undefined ? { paidOn: input.paidOn } : {}),
				},
			};
}
