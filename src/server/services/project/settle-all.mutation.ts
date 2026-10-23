/**
 * project.settleAll: settles every balance you have with the people in one
 * project, one payment per person and currency, each written by
 * payment.record (allocatePayment, payments/*) scoped to the project. The
 * Settle all sheet previews this same mutation and rolls it back (R30), so
 * the lines it lists are exactly the payments Record writes.
 *
 * Record sends back the lines the person saw (`expect`). When the balances
 * moved in between (an expense was added), the plan differs and the write
 * refuses with CONFLICT, so nobody records a payment they did not see.
 *
 * Someone who owes you is recorded as having paid you (final at once);
 * someone you owe gets an outgoing payment (they confirm it when they are on
 * Retrospend). A line payment.record will not write (they already say they
 * paid you) comes back as skipped with its reason. Currencies are never
 * converted: a balance in BRL is settled in BRL.
 */
import { TRPCError } from "@trpc/server";
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

/** One planned payment as the sheet shows it: the person, and what is open in one currency. */
export interface PlannedLine {
	/** `<participantType>:<participantId>`. */
	readonly person: string;
	readonly currency: string;
	/** Positive: they owe you. Negative: you owe them. */
	readonly minor: number;
}

export interface SettleAllInput {
	readonly projectId: string;
	/** The lines the preview showed; Record refuses when the plan differs. */
	readonly expect?: readonly PlannedLine[];
	/** The user's IANA zone, for the payments' date. Set by the transport. */
	readonly timeZone?: string;
}

export interface SettleAllLine {
	readonly person: string;
	readonly direction: "outgoing" | "incoming";
	readonly amount: Money;
	readonly paymentId: string;
	readonly status: "PROPOSED" | "FINALIZED";
}

/** A line Settle all leaves for the person to handle (they already say they paid). */
export interface SkippedLine {
	readonly person: string;
	readonly direction: "outgoing" | "incoming";
	readonly amount: Money;
	readonly reason: "matches_claim" | "overpay" | "nothing_owed";
}

export interface SettleAllValue {
	readonly planned: readonly PlannedLine[];
	readonly lines: readonly SettleAllLine[];
	readonly skipped: readonly SkippedLine[];
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
	const seen = new Set<string>([canonicalKey(me)]);
	return rows.filter((r) => {
		const key = canonicalKey(r);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Every open line between you and the others in the project, in a stable order. */
async function plan(tx: Tx, projectId: string, me: ParticipantRef) {
	const people = await counterparts(tx, projectId, me);
	const balances = await computeBalanceBatch(tx, me, people, {
		projectScope: projectId,
	});
	return people.flatMap((person, i) =>
		Object.entries(balances[i]?.minorByCurrency ?? {})
			.filter(([, minor]) => minor !== 0)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([currency, minor]) => ({ ref: person, currency, minor })),
	);
}

const keyOf = (l: PlannedLine) => `${l.person}|${l.currency}|${l.minor}`;

/** Whether the plan is exactly the lines the person saw (order aside). */
export function samePlan(
	a: readonly PlannedLine[],
	b: readonly PlannedLine[],
): boolean {
	if (a.length !== b.length) return false;
	const seen = new Set(a.map(keyOf));
	return b.every((l) => seen.has(keyOf(l)));
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
			const open = await plan(tx, input.projectId, me);
			const planned = open.map((l) => ({
				person: refKey(l.ref),
				currency: l.currency,
				minor: l.minor,
			}));
			if (input.expect && !samePlan(planned, input.expect)) {
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"The balances in this project changed. Check the new amounts.",
				});
			}
			const lines: SettleAllLine[] = [];
			const skipped: SkippedLine[] = [];
			const rows: RowRef[] = [];
			for (const l of open) {
				const payment: RecordPaymentInput = {
					person: l.ref,
					direction: l.minor > 0 ? "incoming" : "outgoing",
					currency: l.currency,
					amount: null,
					applyTo: [{ scope: input.projectId, currency: l.currency }],
					timeZone: input.timeZone,
				};
				const amount = { minor: Math.abs(l.minor), currency: l.currency };
				const person = refKey(l.ref);
				const { value } = await recordPayment.run(tx, payment, actor);
				if (!value.recorded) {
					skipped.push({
						person,
						direction: payment.direction,
						amount,
						reason: value.reason,
					});
					continue;
				}
				rows.push({ table: "payment", id: value.paymentId });
				lines.push({
					person,
					direction: payment.direction,
					amount,
					paymentId: value.paymentId,
					status: value.status,
				});
			}
			return {
				value: { planned, lines, skipped },
				undo: { kind: "revert", mutation: "project.settleAll", rows },
			};
		},
	};
