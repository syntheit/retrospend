import type { MoneyMutation } from "~/server/services/preview/types";

type Kind = "user" | "guest" | "shadow";

/** One person's share of a split expense on each side of a write. */
export interface ShareChange {
	readonly participantType: Kind;
	readonly participantId: string;
	/** Null when they were not on it before. */
	readonly before: { amount: string; currency: string } | null;
	/** Null when they are not on it after. */
	readonly after: { amount: string; currency: string } | null;
}

/**
 * A split-expense write that also reports what each person owes before and
 * after it, read in its own transaction. A preview rolls it back, so the
 * shares are the dry run's: what Save would leave.
 */
export function withShares<I extends { id: string }, V>(
	mutation: MoneyMutation<I, V>,
): MoneyMutation<I, V & { shares: readonly ShareChange[] }> {
	return {
		...mutation,
		run: async (tx, input, actor) => {
			const read = async () => {
				const row = await tx.sharedTransaction.findUnique({
					where: { id: input.id },
					select: {
						currency: true,
						splitParticipants: {
							select: {
								participantType: true,
								participantId: true,
								shareAmount: true,
							},
						},
					},
				});
				return new Map(
					(row?.splitParticipants ?? []).map((p) => [
						`${p.participantType}:${p.participantId}`,
						{
							participantType: p.participantType as Kind,
							participantId: p.participantId,
							share: {
								amount: p.shareAmount.toString(),
								currency: row?.currency ?? "",
							},
						},
					]),
				);
			};
			const before = await read();
			const done = await mutation.run(tx, input, actor);
			const after = await read();
			const keys = [...new Set([...before.keys(), ...after.keys()])];
			const shares = keys.map((key): ShareChange => {
				const was = before.get(key);
				const now = after.get(key);
				const who = (now ?? was) as NonNullable<typeof was>;
				return {
					participantType: who.participantType,
					participantId: who.participantId,
					before: was?.share ?? null,
					after: now?.share ?? null,
				};
			});
			return { value: { ...done.value, shares }, undo: done.undo };
		},
	};
}
