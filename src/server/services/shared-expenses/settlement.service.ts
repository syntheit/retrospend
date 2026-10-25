import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "@retrospend/domain/money";
import { db as globalDb } from "~/server/db";
import { fromMinor } from "~/server/services/envelope/units";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import { assertRelationship } from "~/server/services/payments/access";
import { claimMatchError } from "~/server/services/payments/claim-match";
import { confirmClaim } from "~/server/services/payments/confirm.mutation";
import {
	ledgerLines,
	overallByCurrency,
} from "~/server/services/payments/ledger";
import {
	type RecordPaymentInput,
	type RecordPaymentValue,
	recordPayment,
} from "~/server/services/payments/record.mutation";
import {
	paymentPerson,
	type ReversePaymentInput,
	rejectPayment,
	removeRecordedPayment,
} from "~/server/services/payments/reverse.mutation";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma, PrismaClient } from "~prisma";
import { computePairLedger } from "./balance";
import {
	describeGroupAmount,
	groupCounterparty,
	groupRoles,
	groupRows,
	summarizeGroup,
} from "./settlement-groups";
import { getSquareUpOptions, squareUpProjects } from "./settlement-square-up";
import { type ParticipantRef, sameParticipant } from "./types";

export { RECORDED_BY_PAYEE_REASON } from "~/server/services/payments/confirmation";

/** An amount with its currency's decimals, for messages (2 for USD, 8 for BTC). */
function formatAmount(amount: number, currency: string): string {
	return amount.toFixed(currencyDecimals(currency));
}

type AppDb = PrismaClient;

/** Owed amounts at or below this are treated as nothing owed. */
const _OWED_TOLERANCE = 0.005;

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
	/** The user's IANA zone, for today's date. */
	timeZone?: string;
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
		if (value.recorded || value.reason !== "matches_claim" || !value.match)
			return;
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
			timeZone: input.timeZone,
			// The old dialog has no overpay confirm: a cent over is what is owed.
			clampOverpayUpTo: 1,
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
		await this.reverse(removeRecordedPayment, settlementId, { mode: "delete" });
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
		await this.reverse(removeRecordedPayment, settlementId, { mode: "void" });
		return { success: true };
	}

	/**
	 * Rejects a pending payment, all its rows at once. Only the person it
	 * waits for can call this (see confirmSettlement). The debt comes back
	 * everywhere, and a billing period the payment had settled reopens.
	 */
	async rejectSettlement(settlementId: string, reason?: string) {
		const { lead, rows, rejectedAt } = await this.reverse(
			rejectPayment,
			settlementId,
			{ reason },
		);
		await this.notifyRejected([...rows], lead);
		return {
			...lead,
			status: "REJECTED" as const,
			rejectedAt,
			rejectedReason: reason ?? null,
		};
	}

	/**
	 * Tells the person who recorded a rejected payment, once for the whole
	 * group. The text is built from the name and the amount only: the reason
	 * is text the person typed, and it stays on the settlement row.
	 */
	async notifyRejected(
		rows: Parameters<typeof describeGroupAmount>[0],
		lead: { id: string; paymentGroupId: string | null },
	) {
		const other = groupCounterparty(rows, this.userId);
		if (other?.participantType !== "user") return;
		const myName = await resolveParticipantName("user", this.userId);
		createNotification({
			userId: other.participantId,
			type: "SETTLEMENT_REJECTED",
			title: "Settlement rejected",
			body: `${myName} rejected your settlement of ${describeGroupAmount(rows, other.participantId)}`,
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

	/**
	 * Runs one of the payment reversals (payments/reverse.mutation.ts) in a
	 * transaction. A caller who is not on the payment locks on themselves; the
	 * mutation then refuses them.
	 */
	private async reverse<I extends ReversePaymentInput, V>(
		mutation: MoneyMutation<I, V>,
		settlementId: string,
		extra: Omit<I, keyof ReversePaymentInput>,
	): Promise<V> {
		return this.db.$transaction(async (tx) => {
			const person =
				(await paymentPerson(tx, settlementId, this.userId)) ??
				this.currentUserRef;
			const { value } = await mutation.run(
				tx,
				{ ...extra, paymentId: settlementId, person } as unknown as I,
				{ userId: this.userId },
			);
			return value;
		});
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
		// Exact minor units (the engine's ledger), so the amount the dialog
		// prefills is exactly what is owed.
		const lines = ledgerLines(
			await computePairLedger(this.db, this.currentUserRef, ref, {
				projectScope: projectId,
			}),
		);
		return [...overallByCurrency(lines)].map(([currency, balance]) => {
			// From my side: positive = they owe me. The opposite debts are the
			// scopes pointing against the overall direction (global view only).
			const offset =
				projectId === undefined
					? lines
							.filter(
								(l) =>
									l.currency === currency &&
									Math.sign(l.balance) === -Math.sign(balance),
							)
							.reduce((sum, l) => sum + Math.abs(l.balance), 0)
					: 0;
			const amount = asNumber(Math.abs(balance), currency);
			return {
				currency,
				balance: amount,
				direction: toDirection(balance),
				suggestedAmount: amount,
				offsetAmount: asNumber(offset, currency),
			};
		});
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
					projectName: group[i]?.project?.name ?? null,
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

	/** See getSquareUpOptions in settlement-square-up.ts. */
	async getSquareUpOptions(ref: ParticipantRef) {
		return getSquareUpOptions(this.db, this.currentUserRef, ref);
	}

	/** See squareUpProjects in settlement-square-up.ts. */
	async squareUpProjects(input: {
		toParticipant: ParticipantRef;
		currency: string;
	}) {
		return squareUpProjects(this.db, this.currentUserRef, input);
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
		timeZone?: string;
	}) {
		const value = await this.record({
			person: input.toParticipant,
			direction: input.direction ?? "outgoing",
			currency: input.paymentCurrency,
			amount: null,
			differentPayment: input.differentPayment,
			timeZone: input.timeZone,
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
