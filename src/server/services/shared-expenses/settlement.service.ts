import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "~/lib/money";
import { db as globalDb } from "~/server/db";
import { fromMinor } from "~/server/services/envelope/units";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import {
	assertRelationship,
	lockPair,
} from "~/server/services/payments/access";
import { allocatePayment } from "~/server/services/payments/allocate";
import { claimMatchError } from "~/server/services/payments/claim-match";
import { confirmClaim } from "~/server/services/payments/confirm.mutation";
import { confirmationFor } from "~/server/services/payments/confirmation";
import { ledgerLines, payerLines } from "~/server/services/payments/ledger";
import {
	type RecordPaymentInput,
	type RecordPaymentValue,
	recordPayment,
} from "~/server/services/payments/record.mutation";
import {
	logGroupAction,
	updateGroup,
	writePayment,
} from "~/server/services/payments/write";
import type { Prisma, PrismaClient, SettlementStatus } from "~prisma";
import {
	computeBalance,
	computeBalanceByProject,
	computePairLedger,
} from "./balance";
import { reopenUnsettledPeriods } from "./billing-period-settle";
import {
	describeGroupAmount,
	groupCounterparty,
	groupRoles,
	groupRows,
	summarizeGroup,
} from "./settlement-groups";
import { type ParticipantRef, sameParticipant } from "./types";

export { RECORDED_BY_PAYEE_REASON } from "~/server/services/payments/confirmation";

/** An amount with its currency's decimals, for messages (2 for USD, 8 for BTC). */
function formatAmount(amount: number, currency: string): string {
	return amount.toFixed(currencyDecimals(currency));
}

type AppDb = PrismaClient;

/** Owed amounts at or below this are treated as nothing owed. */
const OWED_TOLERANCE = 0.005;

function toDirection(
	balance: number,
): "they_owe_you" | "you_owe_them" | "settled" {
	if (balance > 0) return "they_owe_you";
	if (balance < 0) return "you_owe_them";
	return "settled";
}

/**
 * Which way the money moved, from the current user's side.
 * - "outgoing": the current user paid `toParticipant` (the default).
 * - "incoming": `toParticipant` paid the current user. Used to record a
 *   payment received from someone who owed you; the other person is then the
 *   payer and the current user the payee.
 */
export type SettlementDirection = "outgoing" | "incoming";

interface SettlementSides {
	payer: ParticipantRef;
	payee: ParticipantRef;
	/** The current user is the payee and is recording a payment received. */
	recordedByPayee: boolean;
}

/** Reminder count and last reminder of a group (rows are updated together). */
function groupReminderState(
	rows: Array<{ reminderCount: number; reminderSentAt: Date | null }>,
) {
	let count = 0;
	let sentAt: Date | null = null;
	for (const r of rows) {
		count = Math.max(count, r.reminderCount);
		if (r.reminderSentAt && (!sentAt || r.reminderSentAt > sentAt))
			sentAt = r.reminderSentAt;
	}
	return { count, sentAt };
}

/**
 * Currencies where a pair's overall balance is even (within the owed
 * tolerance) while project scopes still point in opposite directions.
 * `byProject` is signed from the current user's side (positive = they owe).
 * `amount` is what squaring up cancels: the larger side of the offsets.
 */
function squareUpCandidates(
	byProject: Map<string | null, Record<string, number>>,
) {
	const currencies = new Set<string>();
	for (const scope of byProject.values())
		for (const c of Object.keys(scope)) currencies.add(c);

	const options: Array<{
		currency: string;
		amount: number;
		scopes: Array<{ projectId: string | null; balance: number }>;
	}> = [];
	for (const currency of [...currencies].sort()) {
		const scopes: Array<{ projectId: string | null; balance: number }> = [];
		let total = 0;
		let owedToMe = 0;
		let owedByMe = 0;
		for (const [projectId, byCurrency] of byProject) {
			const balance = byCurrency[currency] ?? 0;
			if (Math.abs(balance) <= OWED_TOLERANCE) continue;
			scopes.push({ projectId, balance });
			total += balance;
			if (balance > 0) owedToMe += balance;
			else owedByMe -= balance;
		}
		if (owedToMe === 0 || owedByMe === 0) continue;
		if (Math.abs(total) > OWED_TOLERANCE) continue;
		options.push({ currency, amount: Math.max(owedToMe, owedByMe), scopes });
	}
	return options;
}

export interface InitiateSettlementInput {
	/**
	 * The other person. They receive the payment for an "outgoing" settlement
	 * and made it for an "incoming" one.
	 */
	toParticipant: ParticipantRef;
	/** Defaults to "outgoing" (the current user paid). */
	direction?: SettlementDirection;
	amount: number;
	currency: string;
	paymentMethod?: string | null;
	note?: string | null;
	/**
	 * Scope of this settlement.
	 * - string: that project only.
	 * - null: the direct (project-less) bucket only.
	 * - omitted: every scope, allocated by allocatePayment (one row per scope).
	 * Either way only `currency` debts are paid: this entry point never
	 * converts (payment.record does).
	 */
	projectId?: string | null;
	/** Money received that is not the pending payment the payer already claims (§1.5). */
	differentPayment?: boolean;
}

/** Amount in `currency` major units as the decimal string the engine takes. */
const decimalString = (amount: number, currency: string) =>
	amount.toFixed(currencyDecimals(currency));

const asNumber = (minor: number, currency: string) =>
	fromMinor(minor, currency).toNumber();

/**
 * The settle-up entry points of the settlement router. Recording and
 * confirming go through the payments engine (services/payments): one
 * allocator (allocatePayment) and one write path (payment.record), run here
 * inside this service's transaction.
 */
export class SettlementService {
	private currentUserRef: ParticipantRef;

	constructor(
		private db: AppDb,
		private userId: string,
	) {
		this.currentUserRef = { participantType: "user", participantId: userId };
	}

	private sides(
		other: ParticipantRef,
		direction: SettlementDirection | undefined,
	): SettlementSides {
		return direction === "incoming"
			? { payer: other, payee: this.currentUserRef, recordedByPayee: true }
			: { payer: this.currentUserRef, payee: other, recordedByPayee: false };
	}

	/**
	 * Money received that matches a pending claim would count twice: refuse
	 * with the claim named, so the dialog asks to confirm it instead (§1.5).
	 */
	private async refuseClaimMatch(value: RecordPaymentValue): Promise<void> {
		if (value.recorded || value.reason !== "matches_claim" || !value.match) return;
		const header = await this.db.payment.findUnique({
			where: { id: value.match.claim.paymentId },
			select: { payerType: true, payerId: true },
		});
		const name = header
			? await resolveParticipantName(header.payerType, header.payerId)
			: "They";
		throw claimMatchError(value.match, name);
	}

	/** payment.record inside this service's transaction (the same code the preview runs). */
	private async record(input: RecordPaymentInput): Promise<RecordPaymentValue> {
		const { value } = await this.db.$transaction((tx) =>
			recordPayment.run(tx, input, { userId: this.userId }),
		);
		return value;
	}

	/**
	 * Records a payment in one currency between the current user and
	 * `toParticipant`: one the current user made ("outgoing", the default) or
	 * received ("incoming"). Refuses more than the payer owes in that currency
	 * (payment.record allows a confirmed overpayment; this entry point does
	 * not ask). Partial payments are allowed.
	 */
	async initiateSettlement(input: InitiateSettlementInput) {
		const scoped = input.projectId !== undefined;
		const value = await this.record({
			person: input.toParticipant,
			direction: input.direction ?? "outgoing",
			currency: input.currency,
			amount: decimalString(input.amount, input.currency),
			paymentMethod: input.paymentMethod,
			note: input.note,
			differentPayment: input.differentPayment,
			applyTo: [
				scoped
					? { scope: input.projectId ?? null, currency: input.currency }
					: { currency: input.currency },
			],
		});
		if (!value.recorded) {
			await this.refuseClaimMatch(value);
			const owed = value.allocation.full;
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					value.reason === "overpay"
						? `This settlement of ${input.currency} ${formatAmount(input.amount, input.currency)} exceeds the outstanding balance of ${input.currency} ${formatAmount(asNumber(owed.minor, owed.currency), input.currency)} with this person. Enter an amount up to the outstanding balance.`
						: `There is no outstanding ${input.currency} balance to settle with this person${typeof input.projectId === "string" ? " in this project" : ""}.`,
			});
		}
		const settlements = await this.db.settlement.findMany({
			where: { paymentGroupId: value.paymentId },
			orderBy: { initiatedAt: "asc" },
		});
		// The first cash row stands for the payment (offset rows follow it).
		const settlement = settlements.find((s) => !s.isOffset) ?? settlements[0]!;
		if (input.toParticipant.participantType === "user") {
			await this.notifySettlementRecorded(
				this.sides(input.toParticipant, input.direction),
				`${input.currency} ${formatAmount(input.amount, input.currency)}`,
				{ settlementId: settlement.id, paymentGroupId: value.paymentId },
			);
		}
		return {
			settlement,
			settlements,
			warning: null as string | null,
			requiresPayeeConfirmation: value.status === "PROPOSED",
		};
	}

	/**
	 * Tells the registered counterparty about a new settlement: the payee that
	 * a payment was sent (to confirm), or the payer that the payee recorded
	 * receiving their payment.
	 */
	/** Notifies the other person about a payment payment.record wrote (best effort, after commit). */
	async notifyPaymentRecorded(paymentId: string) {
		const header = await this.db.payment.findUnique({
			where: { id: paymentId },
		});
		if (!header) return;
		const payer: ParticipantRef = {
			participantType: header.payerType,
			participantId: header.payerId,
		};
		const payee: ParticipantRef = {
			participantType: header.payeeType,
			participantId: header.payeeId,
		};
		const recordedByPayee = payee.participantId === this.userId;
		const other = recordedByPayee ? payer : payee;
		if (other.participantType !== "user") return;
		const amount = Number(header.amount);
		await this.notifySettlementRecorded(
			{ payer, payee, recordedByPayee },
			`${header.currency} ${formatAmount(amount, header.currency)}`,
			{ paymentGroupId: paymentId },
		);
	}

	private async notifySettlementRecorded(
		sides: SettlementSides,
		formattedAmount: string,
		ids: Record<string, unknown>,
	) {
		const myName = await resolveParticipantName("user", this.userId);
		const notification = sides.recordedByPayee
			? {
					userId: sides.payer.participantId,
					type: "SETTLEMENT_CONFIRMED" as const,
					title: "Payment recorded",
					body: `${myName} recorded receiving your payment of ${formattedAmount}`,
					data: {
						...ids,
						toParticipantType: "user",
						toParticipantId: this.userId,
					},
				}
			: {
					userId: sides.payee.participantId,
					type: "SETTLEMENT_RECEIVED" as const,
					title: "Settlement received",
					body: `${myName} sent you a settlement of ${formattedAmount}`,
					data: {
						...ids,
						fromParticipantType: "user",
						fromParticipantId: this.userId,
					},
				};
		createNotification(notification).catch((err) =>
			console.error(`[Notification Error] ${notification.type}:`, err),
		);
	}

	/**
	 * Confirms a payment. Only the person it waits for can call this: the
	 * payee of a payment sent to them (or the other side of a square-up).
	 * Every row of the payment group turns FINALIZED together.
	 */
	async confirmSettlement(settlementId: string) {
		const { paymentId } = await this.db.$transaction((tx) =>
			confirmClaim(tx, this.currentUserRef, { paymentId: settlementId }),
		);
		const rows = await this.db.settlement.findMany({
			where: { paymentGroupId: paymentId },
			orderBy: { initiatedAt: "asc" },
		});
		const lead =
			rows.find((r) => r.id === settlementId) ??
			rows.find((r) => !r.isOffset) ??
			rows[0]!;
		await this.notifyConfirmed(rows, lead);
		return lead;
	}

	/** Tells the person who recorded a payment that it was confirmed, once per group. */
	async notifyConfirmed(
		rows: Awaited<ReturnType<AppDb["settlement"]["findMany"]>>,
		lead: { id: string; paymentGroupId: string | null },
	) {
		const other = groupCounterparty(rows, this.userId);
		if (other?.participantType !== "user") return;
		const myName = await resolveParticipantName("user", this.userId);
		createNotification({
			userId: other.participantId,
			type: "SETTLEMENT_CONFIRMED",
			title: "Settlement confirmed",
			body: `${myName} confirmed your settlement of ${describeGroupAmount(rows, other.participantId)}`,
			data: {
				settlementId: lead.id,
				paymentGroupId: lead.paymentGroupId,
				toParticipantType: "user",
				toParticipantId: this.userId,
			},
		}).catch((err) =>
			console.error("[Notification Error] SETTLEMENT_CONFIRMED:", err),
		);
	}

	/**
	 * Deletes a pending (unconfirmed) payment with all its rows. Only the
	 * person who recorded it can delete it. Once the other person confirmed,
	 * it cannot be deleted.
	 */
	async deletePendingSettlement(settlementId: string) {
		await this.db.$transaction(async (tx) => {
			const { rows } = await this.loadGroup(tx, settlementId);
			const roles = groupRoles(rows, this.userId);

			if (!roles.isParty) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the payer can delete this settlement",
				});
			}
			if (roles.status === "FINALIZED") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Cannot delete a confirmed settlement",
				});
			}
			if (!roles.recordedByMe) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the payer can delete this settlement",
				});
			}

			await this.deleteGroup(tx, rows, ["PROPOSED", "REJECTED"]);
			await logGroupAction(tx, this.currentUserRef, rows, {
				action: "DELETED",
				context: "settlement_deleted",
				changes: {
					status: roles.status,
					initiatedAt: rows[0]!.initiatedAt.toISOString(),
				},
			});
			// A pending payment counted toward balances; without it a period it
			// settled may be open again.
			await reopenUnsettledPeriods(
				tx,
				rows.map((r) => r.projectId),
				this.currentUserRef,
				{ reason: "settlement_deleted", settlementIds: rows.map((r) => r.id) },
			);
		});

		return { success: true };
	}

	/**
	 * Voids (undoes) a payment that became final without the other person
	 * agreeing to it. Two cases:
	 * - The other person is a shadow or guest. Such a payment is FINALIZED the
	 *   instant it is created, because a non-user can never authenticate to
	 *   confirm it. That auto-finalization is a system convenience, NOT a real
	 *   agreement, so a fat-fingered or wrong-person payment would otherwise
	 *   permanently rewrite a balance with no recourse: deletePending refuses
	 *   finalized rows and reject requires a real user payee.
	 * - The current user recorded a payment they received ("they paid me"):
	 *   they are the one whose claim it reduced, and nobody else confirmed it.
	 *
	 * Voiding hard-deletes every row of the group, which cleanly reverses its
	 * effect because balances are recomputed from the remaining rows (see
	 * computeBalance).
	 *
	 * Protected (NOT voidable) here:
	 * - A payment to a real USER (needs mutual agreement to undo).
	 * - A payment a real user actually confirmed (autoConfirmedReason is null):
	 *   genuine agreement, out of scope.
	 * - A PROPOSED payment (use deletePendingSettlement instead).
	 */
	async voidAutoFinalizedSettlement(settlementId: string) {
		await this.db.$transaction(async (tx) => {
			const { rows } = await this.loadGroup(tx, settlementId);
			const roles = groupRoles(rows, this.userId);

			if (!roles.isParty) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the payer can void this settlement",
				});
			}
			if (!roles.canVoid) {
				const otherIsUser =
					groupCounterparty(rows, this.userId)?.participantType === "user";
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

			await this.deleteGroup(tx, rows, ["FINALIZED"]);
			await logGroupAction(tx, this.currentUserRef, rows, {
				action: "DELETED",
				context: "settlement_voided",
				changes: {
					status: roles.status,
					autoConfirmedReason: rows[0]!.autoConfirmedReason,
					initiatedAt: rows[0]!.initiatedAt.toISOString(),
				},
			});
			await reopenUnsettledPeriods(
				tx,
				rows.map((r) => r.projectId),
				this.currentUserRef,
				{ reason: "settlement_voided", settlementIds: rows.map((r) => r.id) },
			);
		});

		return { success: true };
	}

	/**
	 * Rejects a pending payment, all its rows at once. Only the person it
	 * waits for can call this (see confirmSettlement). The debt comes back
	 * everywhere, and a billing period the payment had settled reopens.
	 */
	async rejectSettlement(settlementId: string, reason?: string) {
		const now = new Date();
		const { lead, rows } = await this.db.$transaction(async (tx) => {
			const { lead, rows } = await this.loadGroup(tx, settlementId);
			const roles = groupRoles(rows, this.userId);

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
				rejectedReason: reason ?? null,
			});
			await tx.payment.updateMany({
				where: { id: { in: groupIdsOf(rows) } },
				data: { status: "REJECTED" },
			});
			await logGroupAction(tx, this.currentUserRef, rows, {
				action: "REJECTED",
				context: "settlement_rejected",
				changes: { reason: reason ?? null },
			});
			await reopenUnsettledPeriods(
				tx,
				rows.map((r) => r.projectId),
				this.currentUserRef,
				{ reason: "settlement_rejected", settlementIds: rows.map((r) => r.id) },
			);
			return { lead, rows };
		});

		// Notify the person who recorded it, once for the whole group.
		const other = groupCounterparty(rows, this.userId);
		if (other?.participantType === "user") {
			const myName = await resolveParticipantName("user", this.userId);
			createNotification({
				userId: other.participantId,
				type: "SETTLEMENT_REJECTED",
				title: "Settlement rejected",
				body: `${myName} rejected your settlement of ${describeGroupAmount(rows, other.participantId)}${reason ? `: ${reason}` : ""}`,
				data: {
					settlementId: lead.id,
					paymentGroupId: lead.paymentGroupId,
					toParticipantType: "user",
					toParticipantId: this.userId,
				},
			}).catch((err) =>
				console.error("[Notification Error] SETTLEMENT_REJECTED:", err),
			);
		}

		return {
			...lead,
			status: "REJECTED" as const,
			rejectedAt: now,
			rejectedReason: reason ?? null,
		};
	}

	/**
	 * Sends a reminder notification for a pending payment (one per group).
	 * Rate-limited: max 3 reminders, minimum 24h between each.
	 */
	async sendReminder(settlementId: string) {
		const { rows } = await this.loadGroup(this.db, settlementId);
		const roles = groupRoles(rows, this.userId);

		if (!roles.isParty || !roles.recordedByMe) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only the payer can send reminders",
			});
		}

		if (roles.status !== "PROPOSED") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Can only remind for pending settlements",
			});
		}

		const reminder = groupReminderState(rows);
		if (reminder.count >= 3) {
			throw new TRPCError({
				code: "TOO_MANY_REQUESTS",
				message: "Maximum number of reminders reached (3)",
			});
		}

		if (reminder.sentAt) {
			const hoursSince =
				(Date.now() - reminder.sentAt.getTime()) / (1000 * 60 * 60);
			if (hoursSince < 24) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "You can send another reminder in 24 hours",
				});
			}
		}

		await this.db.settlement.updateMany({
			where: { id: { in: rows.map((r) => r.id) } },
			data: {
				reminderSentAt: new Date(),
				reminderCount: reminder.count + 1,
			},
		});

		const other = groupCounterparty(rows, this.userId);
		if (other?.participantType === "user") {
			const myName = await resolveParticipantName("user", this.userId);
			createNotification({
				userId: other.participantId,
				type: "PAYMENT_REMINDER",
				title: "Settlement reminder",
				body: `${myName} is reminding you about a settlement of ${describeGroupAmount(rows, other.participantId)}`,
				data: {
					settlementId,
					fromParticipantType: "user",
					fromParticipantId: this.userId,
				},
			}).catch((err) =>
				console.error("[Notification Error] PAYMENT_REMINDER:", err),
			);
		}

		return { success: true };
	}

	/**
	 * Returns the pending payments waiting for the current user to confirm,
	 * one entry per payment group.
	 */
	async getPendingForMe() {
		const rows = await this.db.settlement.findMany({
			where: {
				status: "PROPOSED",
				OR: [
					{ toParticipantType: "user", toParticipantId: this.userId },
					{ fromParticipantType: "user", fromParticipantId: this.userId },
				],
			},
			orderBy: { initiatedAt: "desc" },
		});

		return groupRows(rows)
			.filter((group) => groupRoles(group, this.userId).awaitingMe)
			.map((group) => {
				const lead = group.find((r) => !r.isOffset) ?? group[0]!;
				const summary = summarizeGroup(group, this.userId);
				const other = groupCounterparty(group, this.userId)!;
				return {
					id: lead.id,
					paymentGroupId: lead.paymentGroupId,
					kind: summary.kind,
					amount: summary.amount,
					currency: summary.currency,
					paymentMethod: lead.paymentMethod,
					note: lead.note,
					initiatedAt: lead.initiatedAt,
					fromParticipantType: other.participantType,
					fromParticipantId: other.participantId,
				};
			});
	}

	/**
	 * Sends a balance reminder notification to someone who owes you money.
	 * Does not create a settlement — just nudges the other person.
	 * Rate-limited: one reminder per person per 24 hours.
	 */
	async sendBalanceReminder(input: {
		participantType: "user" | "guest" | "shadow";
		participantId: string;
	}) {
		const ref: ParticipantRef = {
			participantType: input.participantType,
			participantId: input.participantId,
		};

		if (sameParticipant(this.currentUserRef, ref)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Cannot send a reminder to yourself",
			});
		}

		await assertRelationship(this.db, this.currentUserRef, ref);

		if (input.participantType !== "user") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Can only send reminders to registered users",
			});
		}

		// Rate limit: one reminder per person per 24 hours
		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const recentReminder = await globalDb.notification.findFirst({
			where: {
				userId: input.participantId,
				type: "PAYMENT_REMINDER",
				createdAt: { gte: oneDayAgo },
				data: {
					path: ["fromParticipantId"],
					equals: this.userId,
				},
			},
		});

		if (recentReminder) {
			throw new TRPCError({
				code: "TOO_MANY_REQUESTS",
				message: "You already sent a reminder recently. Try again in 24 hours.",
			});
		}

		const myName = await resolveParticipantName("user", this.userId);

		createNotification({
			userId: input.participantId,
			type: "PAYMENT_REMINDER",
			title: "Payment reminder",
			body: `${myName} reminded you about an outstanding balance`,
			data: {
				fromParticipantType: "user",
				fromParticipantId: this.userId,
			},
		}).catch((err) =>
			console.error("[Notification Error] PAYMENT_REMINDER:", err),
		);

		return { success: true };
	}

	/**
	 * Returns per-currency net balances and suggested settlement amounts between
	 * the current user and the specified person. Read-only, no side effects.
	 *
	 * In the global scope, `offsetAmount` is how much of the opposite-direction
	 * project debts in that currency a full settle-up also cancels (see
	 * allocateFullSettlement). 0 when every scope points the same way.
	 */
	async getSettlementPlan(ref: ParticipantRef, projectId?: string | null) {
		await assertRelationship(this.db, this.currentUserRef, ref);

		// Scope the plan to the same scope the settle-up action will write in
		// (string => that project; null => direct bucket; omitted => GLOBAL, the
		// default for the cross-project People view).
		const balanceResult = await computeBalance(
			this.db,
			this.currentUserRef,
			ref,
			{ projectScope: projectId },
		);
		const byProject =
			projectId === undefined
				? await computeBalanceByProject(this.db, this.currentUserRef, ref)
				: null;

		return Object.entries(balanceResult.byCurrency).map(
			([currency, balance]) => {
				// From my side: positive = they owe me. The opposite debts are the
				// scopes pointing against the global direction.
				let offsetAmount = 0;
				if (byProject) {
					for (const scope of byProject.values()) {
						const value = scope[currency] ?? 0;
						if (Math.sign(value) === -Math.sign(balance))
							offsetAmount += Math.abs(value);
					}
				}
				return {
					currency,
					balance: Math.abs(balance),
					direction: toDirection(balance),
					suggestedAmount: Math.abs(balance),
					offsetAmount,
				};
			},
		);
	}

	/**
	 * Returns the payments between the current user and the specified person,
	 * one entry per payment group (a payment split across projects and its
	 * offset rows is one entry), sorted by initiatedAt descending. `parts`
	 * lists the group's rows per project so views can show the breakdown, or
	 * only their own project's part.
	 */
	async getSettlementHistory(ref: ParticipantRef) {
		await assertRelationship(this.db, this.currentUserRef, ref);

		const settlements = await this.db.settlement.findMany({
			where: {
				OR: [
					{
						fromParticipantType: "user",
						fromParticipantId: this.userId,
						toParticipantType: ref.participantType,
						toParticipantId: ref.participantId,
					},
					{
						fromParticipantType: ref.participantType,
						fromParticipantId: ref.participantId,
						toParticipantType: "user",
						toParticipantId: this.userId,
					},
				],
			},
			include: { project: { select: { id: true, name: true } } },
			orderBy: { initiatedAt: "desc" },
		});

		const headers = new Map(
			(
				await this.db.payment.findMany({
					where: { id: { in: groupIdsOf(settlements) } },
				})
			).map((h) => [h.id, h]),
		);

		return groupRows(settlements).map((group) => {
			const lead = group.find((r) => !r.isOffset) ?? group[0]!;
			const roles = groupRoles(group, this.userId);
			const summary = summarizeGroup(group, this.userId);
			const isPending = roles.status === "PROPOSED";
			// One payment, one amount (I4): what was paid, in the currency it was
			// paid in. A square-up pays nothing and shows what it cancelled.
			const header = lead.paymentGroupId
				? headers.get(lead.paymentGroupId)
				: undefined;
			const paid =
				header && summary.kind === "payment"
					? { amount: Number(header.amount), currency: header.currency }
					: { amount: summary.amount, currency: summary.currency };

			let canRemind = false;
			if (roles.recordedByMe && isPending) {
				const reminder = groupReminderState(group);
				canRemind = reminder.count < 3;
				if (reminder.sentAt) {
					const hoursSince =
						(Date.now() - reminder.sentAt.getTime()) / (1000 * 60 * 60);
					if (hoursSince < 24) canRemind = false;
				}
			}

			return {
				id: lead.id,
				paymentGroupId: lead.paymentGroupId,
				kind: summary.kind,
				amount: paid.amount,
				currency: paid.currency,
				paidOn: (header?.paidOn ?? lead.initiatedAt).toISOString().slice(0, 10),
				rateType: header?.rateType ?? null,
				rate: header?.rate ? header.rate.toString() : null,
				rateCurrency: header?.rateCurrency ?? null,
				cashByCurrency: summary.cashByCurrency,
				offsetByCurrency: summary.offsetByCurrency,
				parts: summary.parts.map((part, i) => ({
					...part,
					projectName: group[i]!.project?.name ?? null,
				})),
				convertedAmount:
					group.length === 1 && lead.convertedAmount
						? Number(lead.convertedAmount)
						: null,
				convertedCurrency: group.length === 1 ? lead.convertedCurrency : null,
				exchangeRateUsed:
					group.length === 1 && lead.exchangeRateUsed
						? Number(lead.exchangeRateUsed)
						: null,
				paymentMethod: lead.paymentMethod,
				note: lead.note,
				status:
					roles.status === "REJECTED"
						? ("rejected" as const)
						: roles.status === "FINALIZED"
							? ("confirmed" as const)
							: ("pending_payee_confirmation" as const),
				direction: summary.direction,
				initiatedAt: lead.initiatedAt,
				settledAt: lead.settledAt,
				rejectedAt: lead.rejectedAt,
				rejectedReason: lead.rejectedReason,
				autoConfirmedReason: lead.autoConfirmedReason,
				// Action flags, for the whole group
				canConfirm: roles.awaitingMe,
				canReject: roles.awaitingMe,
				canDelete: roles.recordedByMe && isPending,
				// A payment to a ghost/guest, or one the current user recorded as
				// received, became final without a real agreement and can be undone.
				// Payments a real user confirmed stay protected.
				canVoid: roles.canVoid,
				canRemind,
			};
		});
	}

	/**
	 * Currencies where the overall balance with `ref` is even but project
	 * scopes are not, in opposite directions (e.g. you owe 30 in Trip and are
	 * owed 30 in Rent). Read-only; squareUpProjects records the offsets.
	 */
	async getSquareUpOptions(ref: ParticipantRef) {
		await assertRelationship(this.db, this.currentUserRef, ref);
		const byProject = await computeBalanceByProject(
			this.db,
			this.currentUserRef,
			ref,
		);
		const options = squareUpCandidates(byProject);
		if (options.length === 0) return [];

		const projectIds = [
			...new Set(
				options.flatMap((o) =>
					o.scopes
						.map((s) => s.projectId)
						.filter((p): p is string => p !== null),
				),
			),
		];
		const projects =
			projectIds.length > 0
				? await this.db.project.findMany({
						where: { id: { in: projectIds } },
						select: { id: true, name: true },
					})
				: [];
		const names = new Map(projects.map((p) => [p.id, p.name]));

		return options.map((o) => ({
			...o,
			scopes: o.scopes.map((s) => ({
				...s,
				projectName: s.projectId ? (names.get(s.projectId) ?? null) : null,
			})),
		}));
	}

	/**
	 * "Square up projects": when the overall balance with `toParticipant` in a
	 * currency is even but projects are not, records only offset rows (no
	 * cash) so every project scope ends at zero: allocatePayment with nothing
	 * to pay and everything to offset. Handled like a payment the current
	 * user sends: a registered user confirms or rejects it, a ghost or guest
	 * is auto-confirmed. Same pair lock as a payment.
	 */
	async squareUpProjects(input: {
		toParticipant: ParticipantRef;
		currency: string;
	}) {
		if (sameParticipant(this.currentUserRef, input.toParticipant)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Cannot create a settlement with yourself",
			});
		}
		await assertRelationship(this.db, this.currentUserRef, input.toParticipant);
		const me = this.currentUserRef;
		const other = input.toParticipant;

		const { settlements, paymentGroupId, offset } = await this.db.$transaction(
			async (tx) => {
				await lockPair(tx, me, other);
				const byProject = await computeBalanceByProject(tx, me, other);
				const option = squareUpCandidates(byProject).find(
					(o) => o.currency === input.currency,
				);
				if (!option) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `There are no ${input.currency} project balances to square up with this person.`,
					});
				}
				const events = await computePairLedger(tx, me, other, { viewer: me });
				const allocation = allocatePayment({
					lines: payerLines(ledgerLines(events), true),
					currency: input.currency,
					amount: 0,
					quotes: new Map(),
					applyTo: [{ currency: input.currency }],
				});
				const id = randomUUID();
				const now = new Date();
				const created = await writePayment(tx, {
					id,
					parties: { payer: me, payee: other, recorder: me },
					allocation,
					confirmation: confirmationFor(false, other.participantType),
					paidOn: new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`),
					now,
					paymentMethod: null,
					note: null,
					auditTags: { squareUp: true },
				});
				return {
					settlements: created,
					paymentGroupId: id,
					offset: option.amount,
				};
			},
		);

		if (input.toParticipant.participantType === "user") {
			const myName = await resolveParticipantName("user", this.userId);
			const formatted = `${input.currency} ${formatAmount(offset, input.currency)}`;
			createNotification({
				userId: input.toParticipant.participantId,
				type: "SETTLEMENT_RECEIVED",
				title: "Project balances squared up",
				body: `${myName} squared up your project balances (an offset of ${formatted}, no money moved)`,
				data: {
					settlementId: settlements[0]!.id,
					paymentGroupId,
					fromParticipantType: "user",
					fromParticipantId: this.userId,
				},
			}).catch((err) =>
				console.error("[Notification Error] SETTLEMENT_RECEIVED:", err),
			);
		}

		return {
			settlements,
			paymentGroupId,
			requiresPayeeConfirmation: settlements[0]!.status === "PROPOSED",
		};
	}

	/**
	 * Settles everything with a person at once as one payment in
	 * `paymentCurrency`: allocatePayment with "Everything", so every debt is
	 * paid (same currency first, then converted at the reference rate) and
	 * debts going the other way are offset, across currencies too. With
	 * direction "incoming" the other person is the payer.
	 *
	 * A currency with no exchange rate is left untouched and reported in
	 * `skipped`. If nothing can be paid, throws.
	 */
	async settleAll(input: {
		toParticipant: ParticipantRef;
		/** See InitiateSettlementInput.direction. */
		direction?: SettlementDirection;
		paymentCurrency: string;
		paymentMethod?: string | null;
		note?: string | null;
		projectId?: string | null;
		/** See InitiateSettlementInput.differentPayment. */
		differentPayment?: boolean;
	}) {
		const value = await this.record({
			person: input.toParticipant,
			direction: input.direction ?? "outgoing",
			currency: input.paymentCurrency,
			amount: null,
			differentPayment: input.differentPayment,
			paymentMethod: input.paymentMethod,
			note: input.note,
			applyTo:
				input.projectId === undefined
					? undefined
					: [{ scope: input.projectId }],
			auditTags: { batchSettlement: true },
		});
		const skipped = (value.allocation?.unpriced ?? []).map((currency) => ({
			currency,
			reason: "no_exchange_rate",
		}));
		if (!value.recorded) {
			await this.refuseClaimMatch(value);
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					skipped.length > 0
						? `Could not settle: no exchange rate available to convert ${skipped.map((s) => s.currency).join(", ")} to ${input.paymentCurrency}.`
						: "No outstanding balance to settle",
			});
		}
		const rows = await this.db.settlement.findMany({
			where: { paymentGroupId: value.paymentId },
			orderBy: { initiatedAt: "asc" },
		});
		const settlements = rows.map((settlement) => ({
			id: settlement.id,
			amount: Number(settlement.amount),
			currency: settlement.currency,
			convertedAmount: settlement.convertedAmount
				? Number(settlement.convertedAmount)
				: null,
			convertedCurrency: settlement.convertedCurrency,
			projectId: settlement.projectId ?? null,
			isOffset: settlement.isOffset,
		}));
		const total = value.allocation
			? asNumber(value.allocation.amount.minor, input.paymentCurrency)
			: 0;

		const settledCurrencyCount = new Set(
			settlements.filter((s) => !s.isOffset).map((s) => s.currency),
		).size;
		if (input.toParticipant.participantType === "user") {
			const formattedTotal = `${input.paymentCurrency} ${formatAmount(total, input.paymentCurrency)}`;
			await this.notifySettlementRecorded(
				this.sides(input.toParticipant, input.direction),
				settledCurrencyCount > 1
					? `${formattedTotal} across ${settledCurrencyCount} currencies`
					: formattedTotal,
				{
					settlementIds: settlements.map((s) => s.id),
					paymentGroupId: value.paymentId,
				},
			);
		}

		return {
			settlements,
			paymentGroupId: value.paymentId,
			skipped,
			totalInPaymentCurrency: total,
			paymentCurrency: input.paymentCurrency,
			requiresPayeeConfirmation: value.status === "PROPOSED",
		};
	}

	/**
	 * Loads every row of the payment group `settlementId` belongs to (just
	 * that row for a legacy payment without a group).
	 */
	private async loadGroup(
		db: Pick<PrismaClient, "settlement"> | Prisma.TransactionClient,
		settlementId: string,
	) {
		const lead = await db.settlement.findUnique({
			where: { id: settlementId },
		});
		if (!lead) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Settlement not found",
			});
		}
		if (!lead.paymentGroupId) return { lead, rows: [lead] };
		const rows = await db.settlement.findMany({
			where: { paymentGroupId: lead.paymentGroupId },
			orderBy: { initiatedAt: "asc" },
		});
		return { lead, rows: rows.length > 0 ? rows : [lead] };
	}

	/** Deletes a group's rows (only while they have `fromStatuses`) and its header. */
	private async deleteGroup(
		tx: Prisma.TransactionClient,
		rows: Array<{ id: string; paymentGroupId: string | null }>,
		fromStatuses: SettlementStatus[],
	) {
		const { count } = await tx.settlement.deleteMany({
			where: {
				id: { in: rows.map((r) => r.id) },
				status: { in: fromStatuses },
			},
		});
		if (count !== rows.length) {
			throw new TRPCError({
				code: "CONFLICT",
				message:
					"This payment was changed in the meantime. Refresh and try again.",
			});
		}
		await tx.payment.deleteMany({ where: { id: { in: groupIdsOf(rows) } } });
	}
}

/** The payment headers of a group's rows. */
function groupIdsOf(
	rows: ReadonlyArray<{ paymentGroupId?: string | null }>,
): string[] {
	return [
		...new Set(
			rows.map((r) => r.paymentGroupId).filter((id): id is string => !!id),
		),
	];
}
