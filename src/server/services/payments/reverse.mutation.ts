/**
 * The three ways a payment between two people is taken back or turned down,
 * as money mutations so they can be previewed (R30) and so there is one
 * implementation: SettlementService (tRPC) and /api/v1/payments both run
 * these.
 * - delete: the recorder removes a payment still waiting for the other side.
 * - void: the recorder removes a payment that became final without the
 *   other side's agreement (money received, or paid to someone not on
 *   Retrospend).
 * - reject: the payee says a payment never came.
 * Notifications are sent by the caller after apply, never in here.
 */
import { TRPCError } from "@trpc/server";
import type { FigureDb } from "~/server/figures/registry";
import type { MoneyMutation } from "~/server/services/preview/types";
import { reopenUnsettledPeriods } from "~/server/services/shared-expenses/billing-period-settle";
import {
	type GroupRow,
	groupCounterparty,
	groupRoles,
} from "~/server/services/shared-expenses/settlement-groups";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Settlement } from "~prisma";
import { lockPair } from "./access";
import { PAYMENT_FIGURES } from "./record.mutation";
import { personKey } from "./view";
import { logGroupAction, updateGroup } from "./write";

type Tx = FigureDb;

const userRef = (userId: string): ParticipantRef => ({
	participantType: "user",
	participantId: userId,
});

const notFound = () =>
	new TRPCError({ code: "NOT_FOUND", message: "Settlement not found" });

/**
 * A payment's rows, by the payment's id or by one of its rows' ids. A row
 * from before payments had headers is a group of one, without a header.
 */
export async function loadPaymentGroup(tx: Tx, id: string) {
	const header = await tx.payment.findUnique({ where: { id } });
	const lead = header
		? null
		: await tx.settlement.findUnique({ where: { id } });
	const groupId = header?.id ?? lead?.paymentGroupId ?? null;
	if (!header && !lead) throw notFound();
	let rows: Settlement[];
	if (groupId) {
		rows = await tx.settlement.findMany({
			where: { paymentGroupId: groupId },
			orderBy: { initiatedAt: "asc" },
		});
	} else {
		rows = lead ? [lead] : [];
	}
	if (rows.length === 0) throw notFound();
	const headerIds = [
		...new Set(
			rows.map((r) => r.paymentGroupId).filter((x): x is string => !!x),
		),
	];
	return { headerIds, rows, lead: lead ?? (rows[0] as Settlement), groupId };
}

/** The other person on a payment, for the pair lock and the preview's narrowing; null when `userId` is not on it. */
export async function paymentPerson(
	tx: Tx,
	id: string,
	userId: string,
): Promise<ParticipantRef | null> {
	const { rows } = await loadPaymentGroup(tx, id);
	const other = groupCounterparty(rows as unknown as GroupRow[], userId);
	return other ? (other as ParticipantRef) : null;
}

export interface ReversePaymentInput {
	/** The payment id, or the id of one of its settlement rows. */
	readonly paymentId: string;
	/** The other person, for the preview's narrowing. */
	readonly person: ParticipantRef;
}

export type RemoveMode = "delete" | "void";

export interface RemovePaymentInput extends ReversePaymentInput {
	/** Left out: delete while it waits, void once it is final. */
	readonly mode?: RemoveMode;
}

async function deleteGroup(
	tx: Tx,
	rows: readonly Settlement[],
	headerIds: string[],
	fromStatuses: ("PROPOSED" | "REJECTED" | "FINALIZED")[],
) {
	const { count } = await tx.settlement.deleteMany({
		where: { id: { in: rows.map((r) => r.id) }, status: { in: fromStatuses } },
	});
	if (count !== rows.length) {
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"This payment was changed in the meantime. Refresh and try again.",
		});
	}
	await tx.payment.deleteMany({ where: { id: { in: headerIds } } });
}

function assertCanDelete(roles: ReturnType<typeof groupRoles>) {
	if (!roles.isParty || roles.status === "FINALIZED" || !roles.recordedByMe) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				roles.isParty && roles.status === "FINALIZED"
					? "Cannot delete a confirmed settlement"
					: "Only the payer can delete this settlement",
		});
	}
}

function assertCanVoid(
	rows: readonly Settlement[],
	roles: ReturnType<typeof groupRoles>,
	userId: string,
) {
	if (!roles.isParty) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the payer can void this settlement",
		});
	}
	if (roles.canVoid) return;
	const otherIsUser =
		groupCounterparty(rows as unknown as GroupRow[], userId)
			?.participantType === "user";
	const autoFinalized =
		roles.status === "FINALIZED" &&
		rows.every((r) => r.autoConfirmedReason !== null);
	if (otherIsUser && !roles.recordedByMe) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				"Cannot void a settlement to a registered user. It can only be reversed by mutual agreement.",
		});
	}
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: autoFinalized
			? "This settlement cannot be voided"
			: "Only an auto-finalized settlement can be voided",
	});
}

export const removeRecordedPayment: MoneyMutation<
	RemovePaymentInput,
	{ readonly paymentId: string; readonly mode: RemoveMode }
> = {
	id: "payment.remove",
	touches: PAYMENT_FIGURES,
	scope: (input) => ({ personId: personKey(input.person) }),
	run: async (tx, input, actor) => {
		const me = userRef(actor.userId);
		await lockPair(tx, me, input.person);
		const { rows, headerIds } = await loadPaymentGroup(tx, input.paymentId);
		const group = rows as unknown as GroupRow[];
		const roles = groupRoles(group, actor.userId);
		const mode: RemoveMode =
			input.mode ?? (roles.status === "FINALIZED" ? "void" : "delete");
		if (mode === "delete") {
			assertCanDelete(roles);
			await deleteGroup(tx, rows, headerIds, ["PROPOSED", "REJECTED"]);
			await logGroupAction(tx, me, group, {
				action: "DELETED",
				context: "settlement_deleted",
				changes: {
					status: roles.status,
					initiatedAt: rows[0]?.initiatedAt.toISOString(),
				},
			});
		} else {
			assertCanVoid(rows, roles, actor.userId);
			await deleteGroup(tx, rows, headerIds, ["FINALIZED"]);
			await logGroupAction(tx, me, group, {
				action: "DELETED",
				context: "settlement_voided",
				changes: {
					status: roles.status,
					autoConfirmedReason: rows[0]?.autoConfirmedReason,
					initiatedAt: rows[0]?.initiatedAt.toISOString(),
				},
			});
		}
		// A pending payment counted toward balances; without it a period it
		// settled may be open again.
		const reason =
			mode === "delete" ? "settlement_deleted" : "settlement_voided";
		await reopenUnsettledPeriods(
			tx,
			rows.map((r) => r.projectId),
			me,
			{ reason, settlementIds: rows.map((r) => r.id) },
		);
		return {
			value: { paymentId: input.paymentId, mode },
			undo: { kind: "revert", mutation: "payment.remove", rows: [] },
		};
	},
};

export interface RejectPaymentInput extends ReversePaymentInput {
	readonly reason?: string;
}

export interface RejectedPayment {
	readonly rows: readonly Settlement[];
	/** The row the caller named (the first when it named the payment). */
	readonly lead: Settlement;
	readonly rejectedAt: Date;
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
			const now = new Date();
			const { rows, lead, headerIds } = await loadPaymentGroup(
				tx,
				input.paymentId,
			);
			const group = rows as unknown as GroupRow[];
			const roles = groupRoles(group, actor.userId);
			if (!roles.isParty) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the payee can reject this settlement",
				});
			}
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
			if (!roles.awaitingMe) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the payee can reject this settlement",
				});
			}
			await updateGroup(tx, rows, ["PROPOSED"], {
				status: "REJECTED",
				rejectedAt: now,
				rejectedReason: input.reason ?? null,
			});
			await tx.payment.updateMany({
				where: { id: { in: headerIds } },
				data: { status: "REJECTED" },
			});
			await logGroupAction(tx, me, group, {
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
				value: { rows, lead, rejectedAt: now },
				undo: { kind: "revert", mutation: "payment.reject", rows: [] },
			};
		},
	};
