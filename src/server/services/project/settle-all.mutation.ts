/**
 * project.settleAll: settles every balance you have with the people in one
 * project, one payment per person and currency, each written by
 * payment.record (allocatePayment, payments/*) scoped to the project. The
 * Settle all sheet previews this same mutation and rolls it back (R30), so
 * the lines it lists are exactly the payments Record writes.
 *
 * Someone who owes you is recorded as having paid you (final at once);
 * someone you owe gets an outgoing payment (they confirm it when they are on
 * Retrospend). Currencies are never converted: a balance in BRL is settled
 * in BRL.
 */
import type { Money } from "~/server/figures/registry";
import {
	type RecordPaymentInput,
	recordPayment,
} from "~/server/services/payments/record.mutation";
import type { MoneyMutation, RowRef } from "~/server/services/preview/types";
import { computeBalanceBatch } from "~/server/services/shared-expenses/balance-batch";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { refKey } from "./summary";

export interface SettleAllInput {
	readonly projectId: string;
	/** The user's IANA zone, for the payments' date. Set by the transport. */
	readonly timeZone?: string;
}

export interface SettleAllLine {
	/** `<participantType>:<participantId>`. */
	readonly person: string;
	readonly direction: "outgoing" | "incoming";
	readonly amount: Money;
	readonly paymentId: string;
	readonly status: "PROPOSED" | "FINALIZED";
}

export interface SettleAllValue {
	readonly lines: readonly SettleAllLine[];
}

type Tx = Parameters<typeof recordPayment.run>[0];

/** The other members, one ref per person (a claimed shadow and its user are one). */
async function counterparts(tx: Tx, projectId: string, me: ParticipantRef) {
	const rows = await tx.projectParticipant.findMany({
		where: { projectId },
		select: { participantType: true, participantId: true },
		orderBy: { joinedAt: "asc" },
	});
	const { canonicalKey } = await resolveClaimAliases(tx, [me, ...rows]);
	const mine = canonicalKey(me);
	const seen = new Set<string>([mine]);
	return rows.filter((r) => {
		const key = canonicalKey(r);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export const settleAllInProject: MoneyMutation<SettleAllInput, SettleAllValue> =
	{
		id: "project.settleAll",
		touches: ["project.total", "owed.owedToYou", "owed.youOwe"],
		scope: (input) => ({ projectId: input.projectId }),
		run: async (tx, input, actor) => {
			const me: ParticipantRef = {
				participantType: "user",
				participantId: actor.userId,
			};
			const people = await counterparts(tx, input.projectId, me);
			const balances = await computeBalanceBatch(tx, me, people, {
				projectScope: input.projectId,
			});
			const lines: SettleAllLine[] = [];
			const rows: RowRef[] = [];
			for (const [i, person] of people.entries()) {
				const owed = balances[i]?.minorByCurrency ?? {};
				for (const [currency, minor] of Object.entries(owed).sort()) {
					if (minor === 0) continue;
					const payment: RecordPaymentInput = {
						person,
						direction: minor > 0 ? "incoming" : "outgoing",
						currency,
						amount: null,
						applyTo: [{ scope: input.projectId, currency }],
						timeZone: input.timeZone,
					};
					const { value } = await recordPayment.run(tx, payment, actor);
					if (!value.recorded) continue;
					rows.push({ table: "payment", id: value.paymentId });
					lines.push({
						person: refKey(person),
						direction: payment.direction,
						amount: value.allocation?.amount ?? {
							minor: Math.abs(minor),
							currency,
						},
						paymentId: value.paymentId,
						status: value.status,
					});
				}
			}
			return {
				value: { lines },
				undo: { kind: "revert", mutation: "project.settleAll", rows },
			};
		},
	};
