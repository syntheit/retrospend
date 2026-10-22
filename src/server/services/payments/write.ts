/**
 * Writes a payment: the Payment header, its settlement rows (one per scope
 * and debt currency, then offsets) and one audit entry per scope and
 * currency, so each project feed shows its own part once. Used by
 * payment.record and by confirm's re-allocation; through `tx` only.
 */
import { TRPCError } from "@trpc/server";
import { fromMinor } from "~/server/services/envelope/units";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import {
	type GroupRow,
	summarizeGroup,
} from "~/server/services/shared-expenses/settlement-groups";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma, Settlement, SettlementStatus } from "~prisma";
import {
	type Allocation,
	type PlannedSettlement,
	plannedSettlements,
} from "./allocate";
import { type Confirmation, swappedFlags } from "./confirmation";
import type { Quote } from "./types";

export interface PaymentParties {
	readonly payer: ParticipantRef;
	readonly payee: ParticipantRef;
	/** Who recorded it: the payee for "they paid me", else the payer. */
	readonly recorder: ParticipantRef;
}

export interface WritePaymentArgs {
	readonly id: string;
	readonly parties: PaymentParties;
	readonly allocation: Allocation;
	readonly confirmation: Confirmation;
	readonly paidOn: Date;
	readonly now: Date;
	readonly paymentMethod: string | null;
	readonly note: string | null;
	/** Extra audit context of the entry point (settle-all, square-up). */
	readonly auditTags?: Readonly<Record<string, true>>;
}

const decimal = (minor: number, currency: string) =>
	fromMinor(minor, currency).toString();

/** The header's rate, when everything that converted used one quote. */
function headerRate(allocation: Allocation) {
	const quoted = new Map<string, Quote>();
	for (const row of plannedSettlements(allocation)) {
		if (row.quote) quoted.set(row.currency, row.quote);
	}
	if (quoted.size !== 1)
		return { rateType: null, rate: null, rateCurrency: null };
	const [[currency, quote]] = [...quoted.entries()] as [[string, Quote]];
	return {
		rateType: quote.rateType,
		rate: quote.perUnit.toDecimalPlaces(12).toString(),
		rateCurrency: currency,
	};
}

function rowData(
	args: WritePaymentArgs,
	row: PlannedSettlement,
): Prisma.SettlementUncheckedCreateInput {
	const { payer, payee } = args.parties;
	const P = args.allocation.currency;
	const [from, to] = row.from === "payer" ? [payer, payee] : [payee, payer];
	const { auditAction: _audit, ...confirmation } = args.confirmation;
	const flags =
		row.from === "payer"
			? confirmation
			: { ...confirmation, ...swappedFlags(args.confirmation) };
	const converted =
		!row.isOffset && (row.currency !== P || row.paid !== row.amount);
	return {
		fromParticipantType: from.participantType,
		fromParticipantId: from.participantId,
		toParticipantType: to.participantType,
		toParticipantId: to.participantId,
		amount: decimal(row.amount, row.currency),
		currency: row.currency,
		projectId: row.scope,
		convertedAmount: converted ? decimal(row.paid, P) : null,
		convertedCurrency: converted ? P : null,
		exchangeRateUsed: row.quote
			? row.quote.perUnit.toDecimalPlaces(6).toString()
			: null,
		rateType: row.quote?.rateType ?? null,
		paymentMethod: row.isOffset ? null : args.paymentMethod,
		note: args.note,
		status: flags.status,
		confirmedByPayer: flags.confirmedByPayer,
		confirmedByPayee: flags.confirmedByPayee,
		autoConfirmedReason: flags.autoConfirmedReason,
		settledAt: flags.status === "FINALIZED" ? args.now : null,
		initiatedAt: args.now,
		paymentGroupId: args.id,
		isOffset: row.isOffset,
	};
}

export async function writePayment(
	tx: Prisma.TransactionClient,
	args: WritePaymentArgs,
): Promise<Settlement[]> {
	const { payer, payee, recorder } = args.parties;
	const { allocation } = args;
	await tx.payment.create({
		data: {
			id: args.id,
			payerType: payer.participantType,
			payerId: payer.participantId,
			payeeType: payee.participantType,
			payeeId: payee.participantId,
			amount: decimal(allocation.amount, allocation.currency),
			currency: allocation.currency,
			...headerRate(allocation),
			paymentMethod: args.paymentMethod,
			paidOn: args.paidOn,
			note: args.note,
			recordedByType: recorder.participantType,
			recordedById: recorder.participantId,
			status: args.confirmation.status,
		},
	});
	return writeRows(tx, args);
}

/** The settlement rows of an allocation under an existing header, with their audit. */
export async function writeRows(
	tx: Prisma.TransactionClient,
	args: WritePaymentArgs,
): Promise<Settlement[]> {
	const planned = plannedSettlements(args.allocation);
	const settlements: Settlement[] = [];
	for (const row of planned) {
		settlements.push(await tx.settlement.create({ data: rowData(args, row) }));
	}
	await auditPerScope(tx, args, planned, settlements);
	return settlements;
}

/**
 * Applies `data` to every row of a group, only while each row still has one
 * of `fromStatuses`. If another request changed the group first, the whole
 * action fails rather than touching part of it.
 */
export async function updateGroup(
	tx: Prisma.TransactionClient,
	rows: ReadonlyArray<{ id: string }>,
	fromStatuses: SettlementStatus[],
	data: Prisma.SettlementUpdateManyMutationInput,
) {
	const { count } = await tx.settlement.updateMany({
		where: { id: { in: rows.map((r) => r.id) }, status: { in: fromStatuses } },
		data,
	});
	if (count !== rows.length) {
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"This payment was changed in the meantime. Refresh and try again.",
		});
	}
}

/** One audit entry for an action on a whole group. */
export async function logGroupAction(
	tx: Prisma.TransactionClient,
	actor: ParticipantRef,
	rows: GroupRow[],
	params: {
		action: "SETTLED" | "REJECTED" | "DELETED";
		context: string;
		changes?: Record<string, unknown>;
	},
) {
	// The cash row, or for a square-up a row towards the actor, so the feed
	// names the other person as "from".
	const lead =
		rows.find((r) => !r.isOffset) ??
		rows.find(
			(r) =>
				r.toParticipantType === actor.participantType &&
				r.toParticipantId === actor.participantId,
		) ??
		rows[0];
	if (!lead) return;
	const summary = summarizeGroup(rows, actor.participantId);
	const projectIds = [...new Set(rows.map((r) => r.projectId ?? null))];
	await logAudit(tx, {
		actor,
		action: params.action,
		targetType: "SETTLEMENT",
		targetId: lead.id,
		changes: {
			amount: summary.amount,
			currency: summary.currency,
			fromParticipantType: lead.fromParticipantType,
			fromParticipantId: lead.fromParticipantId,
			toParticipantType: lead.toParticipantType,
			toParticipantId: lead.toParticipantId,
			...(lead.paymentGroupId
				? {
						paymentGroupId: lead.paymentGroupId,
						settlementIds: rows.map((r) => r.id),
					}
				: {}),
			...params.changes,
		} as Prisma.InputJsonValue,
		context: { action: params.context },
		// A group that touched one project shows up in that project's feed.
		projectId:
			projectIds.length === 1 ? (projectIds[0] ?? undefined) : undefined,
	});
}

/** One CREATED entry per scope and currency of the payment. */
async function auditPerScope(
	tx: Prisma.TransactionClient,
	args: WritePaymentArgs,
	planned: readonly PlannedSettlement[],
	settlements: readonly Settlement[],
) {
	const { payer, payee, recorder } = args.parties;
	const recordedByPayee =
		recorder.participantId === payee.participantId &&
		recorder.participantType === payee.participantType;
	const scopes = new Map<string, number[]>();
	planned.forEach((row, i) => {
		const key = `${row.scope ?? ""}|${row.currency}`;
		scopes.set(key, [...(scopes.get(key) ?? []), i]);
	});
	for (const indexes of scopes.values()) {
		const first = planned[indexes[0] ?? 0];
		if (!first) continue;
		const cash = indexes.filter((i) => !planned[i]?.isOffset);
		const offsets = indexes.filter((i) => planned[i]?.isOffset);
		const sum = (list: number[]) =>
			list.reduce((t, i) => t + (planned[i]?.amount ?? 0), 0);
		// The feed shows "part of" when this currency's cash spans scopes.
		const currencyCash = planned
			.filter((r) => !r.isOffset && r.currency === first.currency)
			.reduce((t, r) => t + r.amount, 0);
		await logAudit(tx, {
			actor: recorder,
			action: "CREATED",
			targetType: "SETTLEMENT",
			targetId: settlements[indexes[0] ?? 0]?.id ?? args.id,
			changes: {
				amount: Number(decimal(sum(cash), first.currency)),
				currency: first.currency,
				...(recordedByPayee
					? {
							fromParticipantType: payer.participantType,
							fromParticipantId: payer.participantId,
						}
					: {}),
				toParticipantType: payee.participantType,
				toParticipantId: payee.participantId,
				projectId: first.scope,
				paymentGroupId: args.id,
				settlementIds: indexes.map((i) => settlements[i]?.id ?? ""),
				...(currencyCash > sum(cash)
					? {
							allocatedFromTotal: Number(decimal(currencyCash, first.currency)),
						}
					: {}),
				paidAmount: Number(
					decimal(args.allocation.amount, args.allocation.currency),
				),
				paidCurrency: args.allocation.currency,
				...(offsets.length > 0
					? { offsetAmount: Number(decimal(sum(offsets), first.currency)) }
					: {}),
				...args.auditTags,
			},
			context: { action: args.confirmation.auditAction, ...args.auditTags },
			projectId: first.scope ?? undefined,
		});
	}
}
