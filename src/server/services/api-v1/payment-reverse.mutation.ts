/**
 * The two payment writes that had no money mutation, so no preview: taking
 * back a payment you recorded, and saying a payment never came. Each does
 * what SettlementService.deletePendingSettlement / voidAutoFinalizedSettlement
 * and rejectSettlement do (same guards, same audit entries, same reopening
 * of settled periods), as a MoneyMutation so v1 can preview it (R30). The
 * web's own routes keep calling the service; the two must change together.
 * Notifications are sent by the caller after apply, never in here.
 */
import { TRPCError } from "@trpc/server";
import type { FigureDb } from "~/server/figures/registry";
import { lockPair } from "~/server/services/payments/access";
import { PAYMENT_FIGURES } from "~/server/services/payments/record.mutation";
import { personKey } from "~/server/services/payments/view";
import { logGroupAction, updateGroup } from "~/server/services/payments/write";
import type { MoneyMutation } from "~/server/services/preview/types";
import { reopenUnsettledPeriods } from "~/server/services/shared-expenses/billing-period-settle";
import {
	type GroupRow,
	groupRoles,
} from "~/server/services/shared-expenses/settlement-groups";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";

type Tx = FigureDb;

export interface ReversePaymentInput {
	readonly paymentId: string;
	/** The other person, for the preview's narrowing. */
	readonly person: ParticipantRef;
}

const userRef = (userId: string): ParticipantRef => ({
	participantType: "user",
	participantId: userId,
});

/** The payment header and its rows, by the payment's id or one of its rows' ids. */
async function loadPayment(tx: Tx, id: string) {
	let header = await tx.payment.findUnique({ where: { id } });
	if (!header) {
		const row = await tx.settlement.findUnique({
			where: { id },
			select: { paymentGroupId: true },
		});
		header = row?.paymentGroupId
			? await tx.payment.findUnique({ where: { id: row.paymentGroupId } })
			: null;
	}
	if (!header) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Settlement not found" });
	}
	const rows = await tx.settlement.findMany({
		where: { paymentGroupId: header.id },
		orderBy: { initiatedAt: "asc" },
	});
	if (rows.length === 0) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Settlement not found" });
	}
	return { header, rows: rows as unknown as (GroupRow & { id: string })[] };
}

async function deleteGroup(
	tx: Tx,
	headerId: string,
	rows: readonly GroupRow[],
	fromStatus: "PROPOSED" | "FINALIZED",
) {
	const statuses = fromStatus === "PROPOSED" ? ["PROPOSED", "REJECTED"] : [fromStatus];
	const { count } = await tx.settlement.deleteMany({
		where: {
			id: { in: rows.map((r) => r.id) },
			status: { in: statuses as ("PROPOSED" | "REJECTED" | "FINALIZED")[] },
		},
	});
	if (count !== rows.length) {
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"This payment was changed in the meantime. Refresh and try again.",
		});
	}
	await tx.payment.deleteMany({ where: { id: headerId } });
}

/**
 * Takes back a payment you recorded. One still waiting for the other person
 * is deleted (only its recorder may); a final one you recorded (money
 * received, or paid to someone not on Retrospend) is voided. A payment the
 * other person really confirmed stays: that takes both of you.
 */
export const removeRecordedPayment: MoneyMutation<
	ReversePaymentInput,
	{ readonly paymentId: string }
> = {
	id: "payment.remove",
	touches: PAYMENT_FIGURES,
	scope: (input) => ({ personId: personKey(input.person) }),
	run: async (tx, input, actor) => {
		const me = userRef(actor.userId);
		await lockPair(tx, me, input.person);
		const { header, rows } = await loadPayment(tx, input.paymentId);
		const roles = groupRoles(rows, actor.userId);
		const pending = header.status === "PROPOSED";
		if (!roles.isParty || (pending && !roles.recordedByMe)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only the person who recorded this payment can undo it",
			});
		}
		if (!pending && !roles.canVoid) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message:
					"This payment was confirmed, so it can only be reversed by mutual agreement",
			});
		}
		await deleteGroup(tx, header.id, rows, pending ? "PROPOSED" : "FINALIZED");
		await logGroupAction(tx, me, rows, {
			action: "DELETED",
			context: pending ? "settlement_deleted" : "settlement_voided",
			changes: { status: roles.status },
		});
		await reopenUnsettledPeriods(
			tx,
			rows.map((r) => r.projectId),
			me,
			{
				reason: pending ? "settlement_deleted" : "settlement_voided",
				settlementIds: rows.map((r) => r.id),
			},
		);
		return {
			value: { paymentId: header.id },
			undo: { kind: "revert", mutation: "payment.remove", rows: [] },
		};
	},
};

export interface RejectPaymentInput extends ReversePaymentInput {
	readonly reason?: string;
}

export interface RejectedPayment {
	readonly paymentId: string;
	/** The rows as they were, for the notice the caller sends. */
	readonly rows: readonly GroupRow[];
	readonly leadId: string;
}

/** The payment never came: rejects the whole group; the debt comes back. */
export const rejectPayment: MoneyMutation<RejectPaymentInput, RejectedPayment> =
	{
		id: "payment.reject",
		touches: PAYMENT_FIGURES,
		scope: (input) => ({ personId: personKey(input.person) }),
		run: async (tx, input, actor) => {
			const me = userRef(actor.userId);
			await lockPair(tx, me, input.person);
			const { header, rows } = await loadPayment(tx, input.paymentId);
			const roles = groupRoles(rows, actor.userId);
			if (roles.status === "FINALIZED") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Settlement is already confirmed",
				});
			}
			if (roles.status === "REJECTED") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Settlement is already rejected",
				});
			}
			if (!roles.isParty || !roles.awaitingMe) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the payee can reject this settlement",
				});
			}
			await updateGroup(tx, rows, ["PROPOSED"], {
				status: "REJECTED",
				rejectedAt: new Date(),
				rejectedReason: input.reason ?? null,
			});
			await tx.payment.update({
				where: { id: header.id },
				data: { status: "REJECTED" },
			});
			await logGroupAction(tx, me, rows, {
				action: "REJECTED",
				context: "settlement_rejected",
				changes: { reason: input.reason ?? null },
			});
			await reopenUnsettledPeriods(
				tx,
				rows.map((r) => r.projectId),
				me,
				{
					reason: "settlement_rejected",
					settlementIds: rows.map((r) => r.id),
				},
			);
			return {
				value: {
					paymentId: header.id,
					rows,
					leadId: (rows.find((r) => !r.isOffset) ?? rows[0])?.id ?? header.id,
				},
				undo: { kind: "revert", mutation: "payment.reject", rows: [] },
			};
		},
	};
