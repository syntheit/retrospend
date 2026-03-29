import { TRPCError } from "@trpc/server";
import { toUSD, fromUSD } from "~/server/currency";
import { db as globalDb } from "~/server/db";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import { getBestExchangeRate } from "~/server/api/routers/shared-currency";
import type { PrismaClient } from "~prisma";
import { logAudit } from "./audit-log";
import { computeBalance } from "./balance";
import { type ParticipantRef, sameParticipant } from "./types";

type AppDb = PrismaClient;

function toDirection(
	balance: number,
): "they_owe_you" | "you_owe_them" | "settled" {
	if (balance > 0) return "they_owe_you";
	if (balance < 0) return "you_owe_them";
	return "settled";
}

export interface InitiateSettlementInput {
	toParticipant: ParticipantRef;
	amount: number;
	currency: string;
	convertedAmount?: number | null;
	convertedCurrency?: string | null;
	exchangeRateUsed?: number | null;
	paymentMethod?: string | null;
	note?: string | null;
}

export class SettlementService {
	private currentUserRef: ParticipantRef;

	constructor(
		private db: AppDb,
		private userId: string,
	) {
		this.currentUserRef = { participantType: "user", participantId: userId };
	}

	/**
	 * Creates a new settlement record initiated by the current user (the payer).
	 * Warns (but does not block) if the settlement exceeds the current balance owed.
	 * Auto-confirms immediately for non-user recipients (shadow/guest) who cannot authenticate.
	 */
	async initiateSettlement(input: InitiateSettlementInput) {
		if (sameParticipant(this.currentUserRef, input.toParticipant)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Cannot create a settlement with yourself",
			});
		}

		await this.assertRelationship(input.toParticipant);

		const isNonUserRecipient = input.toParticipant.participantType !== "user";

		// Wrap balance check + create + audit in a transaction to prevent
		// concurrent settlements from racing past the balance check.
		const { settlement, warning } = await this.db.$transaction(async (tx) => {
			// computeBalance(currentUser, other): positive = other owes us, negative = we owe other.
			const balanceResult = await computeBalance(
				tx as unknown as PrismaClient,
				this.currentUserRef,
				input.toParticipant,
			);
			const rawBalance = balanceResult.byCurrency[input.currency] ?? 0;
			const amountOwed = Math.max(0, -rawBalance);

			let warning: string | null = null;
			if (input.amount > amountOwed + 0.01) {
				const excess = (input.amount - amountOwed).toFixed(2);
				warning = `This settlement exceeds your current balance with this person by ${input.currency} ${excess}.`;
			}

			const settlement = await tx.settlement.create({
				data: {
					fromParticipantType: this.currentUserRef.participantType,
					fromParticipantId: this.currentUserRef.participantId,
					toParticipantType: input.toParticipant.participantType,
					toParticipantId: input.toParticipant.participantId,
					amount: input.amount,
					currency: input.currency,
					convertedAmount: input.convertedAmount ?? null,
					convertedCurrency: input.convertedCurrency ?? null,
					exchangeRateUsed: input.exchangeRateUsed ?? null,
					paymentMethod: input.paymentMethod ?? null,
					note: input.note ?? null,
					confirmedByPayer: true,
					// Auto-confirm for non-user recipients
					confirmedByPayee: isNonUserRecipient,
					status: isNonUserRecipient ? "FINALIZED" : "PROPOSED",
					initiatedAt: new Date(),
					settledAt: isNonUserRecipient ? new Date() : null,
					autoConfirmedReason: isNonUserRecipient
						? `Recipient is a ${input.toParticipant.participantType} and cannot confirm`
						: null,
				},
			});

			await logAudit(tx, {
				actor: this.currentUserRef,
				action: "CREATED",
				targetType: "SETTLEMENT",
				targetId: settlement.id,
				changes: {
					amount: input.amount,
					currency: input.currency,
					toParticipantType: input.toParticipant.participantType,
					toParticipantId: input.toParticipant.participantId,
				},
				context: {
					action: isNonUserRecipient
						? "settlement_auto_confirmed"
						: "settlement_initiated",
				},
			});

			return { settlement, warning };
		});

		// Notify the payee if they're a registered user (outside transaction, best-effort)
		if (input.toParticipant.participantType === "user") {
			const payerName = await resolveParticipantName("user", this.userId);
			createNotification({
				userId: input.toParticipant.participantId,
				type: "SETTLEMENT_RECEIVED",
				title: "Settlement received",
				body: `${payerName} sent you a settlement of ${input.currency} ${input.amount.toFixed(2)}`,
				data: {
					settlementId: settlement.id,
					fromParticipantType: "user",
					fromParticipantId: this.userId,
				},
			}).catch((err) =>
				console.error("[Notification Error] SETTLEMENT_RECEIVED:", err),
			);
		}

		return {
			settlement,
			warning,
			requiresPayeeConfirmation: !isNonUserRecipient,
		};
	}

	/**
	 * Confirms a settlement. Only the payee (toParticipant) can call this.
	 * Sets confirmedByPayee=true, status=FINALIZED, settledAt=now.
	 */
	async confirmSettlement(settlementId: string) {
		const settlement = await this.db.settlement.findUnique({
			where: { id: settlementId },
		});

		if (!settlement) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Settlement not found",
			});
		}

		if (
			settlement.toParticipantType !== "user" ||
			settlement.toParticipantId !== this.userId
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only the payee can confirm this settlement",
			});
		}

		if (settlement.confirmedByPayee) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Settlement is already confirmed",
			});
		}

		const updated = await this.db.settlement.update({
			where: { id: settlementId },
			data: {
				confirmedByPayee: true,
				status: "FINALIZED",
				settledAt: new Date(),
			},
		});

		await logAudit(this.db, {
			actor: this.currentUserRef,
			action: "SETTLED",
			targetType: "SETTLEMENT",
			targetId: settlementId,
			changes: {
				amount: Number(settlement.amount),
				currency: settlement.currency,
				fromParticipantType: settlement.fromParticipantType,
				fromParticipantId: settlement.fromParticipantId,
			},
			context: { action: "settlement_confirmed" },
		});

		// Notify the payer that their settlement was confirmed
		if (settlement.fromParticipantType === "user") {
			const payeeName = await resolveParticipantName("user", this.userId);
			createNotification({
				userId: settlement.fromParticipantId,
				type: "SETTLEMENT_CONFIRMED",
				title: "Settlement confirmed",
				body: `${payeeName} confirmed your settlement of ${settlement.currency} ${Number(settlement.amount).toFixed(2)}`,
				data: {
					settlementId,
					toParticipantType: "user",
					toParticipantId: this.userId,
				},
			}).catch((err) =>
				console.error("[Notification Error] SETTLEMENT_CONFIRMED:", err),
			);
		}

		return updated;
	}

	/**
	 * Deletes a pending (unconfirmed) settlement. Only the payer can delete.
	 * Once confirmed by the payee, a settlement cannot be deleted.
	 */
	async deletePendingSettlement(settlementId: string) {
		const settlement = await this.db.settlement.findUnique({
			where: { id: settlementId },
		});

		if (!settlement) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Settlement not found",
			});
		}

		if (
			settlement.fromParticipantType !== "user" ||
			settlement.fromParticipantId !== this.userId
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only the payer can delete this settlement",
			});
		}

		if (settlement.confirmedByPayee) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Cannot delete a confirmed settlement",
			});
		}

		await this.db.settlement.delete({ where: { id: settlementId } });

		await logAudit(this.db, {
			actor: this.currentUserRef,
			action: "DELETED",
			targetType: "SETTLEMENT",
			targetId: settlementId,
			changes: {
				amount: Number(settlement.amount),
				currency: settlement.currency,
				fromParticipantType: settlement.fromParticipantType,
				fromParticipantId: settlement.fromParticipantId,
				toParticipantType: settlement.toParticipantType,
				toParticipantId: settlement.toParticipantId,
				status: settlement.status,
				initiatedAt: settlement.initiatedAt.toISOString(),
			},
		});

		return { success: true };
	}

	/**
	 * Rejects a pending settlement. Only the payee (toParticipant) can call this.
	 */
	async rejectSettlement(settlementId: string, reason?: string) {
		const settlement = await this.db.settlement.findUnique({
			where: { id: settlementId },
		});

		if (!settlement) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Settlement not found",
			});
		}

		if (
			settlement.toParticipantType !== "user" ||
			settlement.toParticipantId !== this.userId
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only the payee can reject this settlement",
			});
		}

		if (settlement.confirmedByPayee) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Settlement is already confirmed",
			});
		}

		if (settlement.status === "REJECTED") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Settlement is already rejected",
			});
		}

		const updated = await this.db.settlement.update({
			where: { id: settlementId },
			data: {
				status: "REJECTED",
				rejectedAt: new Date(),
				rejectedReason: reason ?? null,
			},
		});

		await logAudit(this.db, {
			actor: this.currentUserRef,
			action: "REJECTED",
			targetType: "SETTLEMENT",
			targetId: settlementId,
			changes: {
				amount: Number(settlement.amount),
				currency: settlement.currency,
				reason: reason ?? null,
			},
			context: { action: "settlement_rejected" },
		});

		// Notify the payer
		if (settlement.fromParticipantType === "user") {
			const payeeName = await resolveParticipantName("user", this.userId);
			createNotification({
				userId: settlement.fromParticipantId,
				type: "SETTLEMENT_REJECTED",
				title: "Settlement rejected",
				body: `${payeeName} rejected your settlement of ${settlement.currency} ${Number(settlement.amount).toFixed(2)}${reason ? `: ${reason}` : ""}`,
				data: {
					settlementId,
					toParticipantType: "user",
					toParticipantId: this.userId,
				},
			}).catch((err) =>
				console.error("[Notification Error] SETTLEMENT_REJECTED:", err),
			);
		}

		return updated;
	}

	/**
	 * Sends a reminder notification for a pending settlement.
	 * Rate-limited: max 3 reminders, minimum 24h between each.
	 */
	async sendReminder(settlementId: string) {
		const settlement = await this.db.settlement.findUnique({
			where: { id: settlementId },
		});

		if (!settlement) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Settlement not found" });
		}

		if (
			settlement.fromParticipantType !== "user" ||
			settlement.fromParticipantId !== this.userId
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only the payer can send reminders",
			});
		}

		if (settlement.status !== "PROPOSED") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Can only remind for pending settlements",
			});
		}

		if (settlement.reminderCount >= 3) {
			throw new TRPCError({
				code: "TOO_MANY_REQUESTS",
				message: "Maximum number of reminders reached (3)",
			});
		}

		if (settlement.reminderSentAt) {
			const hoursSince =
				(Date.now() - settlement.reminderSentAt.getTime()) / (1000 * 60 * 60);
			if (hoursSince < 24) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "You can send another reminder in 24 hours",
				});
			}
		}

		await this.db.settlement.update({
			where: { id: settlementId },
			data: {
				reminderSentAt: new Date(),
				reminderCount: { increment: 1 },
			},
		});

		if (settlement.toParticipantType === "user") {
			const payerName = await resolveParticipantName("user", this.userId);
			createNotification({
				userId: settlement.toParticipantId,
				type: "PAYMENT_REMINDER",
				title: "Settlement reminder",
				body: `${payerName} is reminding you about a settlement of ${settlement.currency} ${Number(settlement.amount).toFixed(2)}`,
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
	 * Returns PROPOSED settlements where the current user is the payee.
	 */
	async getPendingForMe() {
		const settlements = await this.db.settlement.findMany({
			where: {
				toParticipantType: "user",
				toParticipantId: this.userId,
				status: "PROPOSED",
			},
			orderBy: { initiatedAt: "desc" },
		});

		return settlements.map((s) => ({
			id: s.id,
			amount: Number(s.amount),
			currency: s.currency,
			paymentMethod: s.paymentMethod,
			note: s.note,
			initiatedAt: s.initiatedAt,
			fromParticipantType: s.fromParticipantType,
			fromParticipantId: s.fromParticipantId,
		}));
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

		await this.assertRelationship(ref);

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
	 */
	async getSettlementPlan(ref: ParticipantRef) {
		await this.assertRelationship(ref);

		const balanceResult = await computeBalance(
			this.db,
			this.currentUserRef,
			ref,
		);

		return Object.entries(balanceResult.byCurrency).map(
			([currency, balance]) => ({
				currency,
				balance: Math.abs(balance),
				direction: toDirection(balance),
				suggestedAmount: Math.abs(balance),
			}),
		);
	}

	/**
	 * Returns all settlement records between the current user and the specified
	 * person, sorted by initiatedAt descending.
	 */
	async getSettlementHistory(ref: ParticipantRef) {
		await this.assertRelationship(ref);

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
			orderBy: { initiatedAt: "desc" },
		});

		return settlements.map((s) => {
			const isOutgoing = s.fromParticipantId === this.userId;
			const isPending = s.status === "PROPOSED";
			const isPayee = s.toParticipantType === "user" && s.toParticipantId === this.userId;
			const isPayer = s.fromParticipantType === "user" && s.fromParticipantId === this.userId;

			let canRemind = false;
			if (isPayer && isPending) {
				canRemind = s.reminderCount < 3;
				if (s.reminderSentAt) {
					const hoursSince = (Date.now() - s.reminderSentAt.getTime()) / (1000 * 60 * 60);
					if (hoursSince < 24) canRemind = false;
				}
			}

			return {
				id: s.id,
				amount: Number(s.amount),
				currency: s.currency,
				convertedAmount: s.convertedAmount ? Number(s.convertedAmount) : null,
				convertedCurrency: s.convertedCurrency,
				exchangeRateUsed: s.exchangeRateUsed ? Number(s.exchangeRateUsed) : null,
				paymentMethod: s.paymentMethod,
				note: s.note,
				status: s.status === "REJECTED"
					? ("rejected" as const)
					: s.confirmedByPayee
						? ("confirmed" as const)
						: ("pending_payee_confirmation" as const),
				direction: isOutgoing ? ("outgoing" as const) : ("incoming" as const),
				initiatedAt: s.initiatedAt,
				settledAt: s.settledAt,
				rejectedAt: s.rejectedAt,
				rejectedReason: s.rejectedReason,
				autoConfirmedReason: s.autoConfirmedReason,
				// Action flags
				canConfirm: isPayee && isPending,
				canReject: isPayee && isPending,
				canDelete: isPayer && isPending,
				canRemind,
			};
		});
	}

	/**
	 * Settles ALL outstanding balances with a person at once.
	 * Creates one settlement per currency, atomically in a single transaction.
	 * Each settlement records the converted amount in the payment currency.
	 *
	 * Only settles currencies where the current user owes the other person
	 * (negative balance = you_owe_them).
	 */
	async settleAll(input: {
		toParticipant: ParticipantRef;
		paymentCurrency: string;
		paymentMethod?: string | null;
		note?: string | null;
	}) {
		if (sameParticipant(this.currentUserRef, input.toParticipant)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Cannot create a settlement with yourself",
			});
		}

		await this.assertRelationship(input.toParticipant);

		const isNonUserRecipient = input.toParticipant.participantType !== "user";

		// Compute all per-currency balances
		const balanceResult = await computeBalance(
			this.db,
			this.currentUserRef,
			input.toParticipant,
		);

		// Filter to currencies where we owe them (negative balance)
		const entries = Object.entries(balanceResult.byCurrency)
			.filter(([, balance]) => balance < -0.00000001)
			.map(([currency, balance]) => ({ currency, amount: Math.abs(balance) }));

		if (entries.length === 0) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "No outstanding balance to settle",
			});
		}

		// Fetch exchange rates for currencies that differ from payment currency
		const currenciesToConvert = entries
			.map((e) => e.currency)
			.filter((c) => c !== input.paymentCurrency);

		const rateMap = new Map<string, number>();
		const now = new Date();

		for (const currency of currenciesToConvert) {
			const result = await getBestExchangeRate(
				this.db as PrismaClient,
				currency,
				now,
			);
			if (result) rateMap.set(currency, result.rate);
		}

		// Also get rate for payment currency (needed for cross-currency conversion)
		if (input.paymentCurrency !== "USD" && !rateMap.has(input.paymentCurrency)) {
			const result = await getBestExchangeRate(
				this.db as PrismaClient,
				input.paymentCurrency,
				now,
			);
			if (result) rateMap.set(input.paymentCurrency, result.rate);
		}

		// Create all settlements in a single transaction
		const { settlements, totalInPaymentCurrency } =
			await this.db.$transaction(async (tx) => {
				const settlements: Array<{
					id: string;
					amount: number;
					currency: string;
					convertedAmount: number | null;
					convertedCurrency: string | null;
				}> = [];
				let totalInPaymentCurrency = 0;

				for (const entry of entries) {
					let convertedAmount: number | null = null;
					let convertedCurrency: string | null = null;
					let exchangeRateUsed: number | null = null;

					if (entry.currency !== input.paymentCurrency) {
						// Convert via USD: source → USD → paymentCurrency
						const sourceRate = rateMap.get(entry.currency);
						const targetRate =
							input.paymentCurrency === "USD"
								? 1
								: rateMap.get(input.paymentCurrency);

						if (sourceRate && targetRate) {
							const usdAmount = toUSD(
								entry.amount,
								entry.currency,
								sourceRate,
							);
							const converted =
								input.paymentCurrency === "USD"
									? usdAmount
									: fromUSD(usdAmount, input.paymentCurrency, targetRate);

							convertedAmount =
								Math.round(converted * 100) / 100;
							convertedCurrency = input.paymentCurrency;
							exchangeRateUsed = sourceRate;
							totalInPaymentCurrency += convertedAmount;
						} else {
							// Fallback: cannot convert, record without conversion
							totalInPaymentCurrency += entry.amount;
						}
					} else {
						totalInPaymentCurrency += entry.amount;
					}

					const settlement = await tx.settlement.create({
						data: {
							fromParticipantType:
								this.currentUserRef.participantType,
							fromParticipantId:
								this.currentUserRef.participantId,
							toParticipantType:
								input.toParticipant.participantType,
							toParticipantId:
								input.toParticipant.participantId,
							amount: entry.amount,
							currency: entry.currency,
							convertedAmount,
							convertedCurrency,
							exchangeRateUsed,
							paymentMethod: input.paymentMethod ?? null,
							note: input.note ?? null,
							confirmedByPayer: true,
							confirmedByPayee: isNonUserRecipient,
							status: isNonUserRecipient
								? "FINALIZED"
								: "PROPOSED",
							initiatedAt: now,
							settledAt: isNonUserRecipient ? now : null,
							autoConfirmedReason: isNonUserRecipient
								? `Recipient is a ${input.toParticipant.participantType} and cannot confirm`
								: null,
						},
					});

					await logAudit(tx, {
						actor: this.currentUserRef,
						action: "CREATED",
						targetType: "SETTLEMENT",
						targetId: settlement.id,
						changes: {
							amount: entry.amount,
							currency: entry.currency,
							toParticipantType:
								input.toParticipant.participantType,
							toParticipantId:
								input.toParticipant.participantId,
							batchSettlement: true,
						},
						context: {
							action: isNonUserRecipient
								? "settlement_auto_confirmed"
								: "settlement_initiated",
							batch: true,
						},
					});

					settlements.push({
						id: settlement.id,
						amount: Number(settlement.amount),
						currency: settlement.currency,
						convertedAmount: settlement.convertedAmount
							? Number(settlement.convertedAmount)
							: null,
						convertedCurrency: settlement.convertedCurrency,
					});
				}

				return { settlements, totalInPaymentCurrency };
			});

		// Send a single notification for the batch
		if (input.toParticipant.participantType === "user") {
			const payerName = await resolveParticipantName("user", this.userId);
			const formattedTotal = totalInPaymentCurrency.toFixed(2);
			createNotification({
				userId: input.toParticipant.participantId,
				type: "SETTLEMENT_RECEIVED",
				title: "Settlement received",
				body:
					settlements.length > 1
						? `${payerName} sent you a settlement of ${input.paymentCurrency} ${formattedTotal} across ${settlements.length} currencies`
						: `${payerName} sent you a settlement of ${input.paymentCurrency} ${formattedTotal}`,
				data: {
					settlementIds: settlements.map((s) => s.id),
					fromParticipantType: "user",
					fromParticipantId: this.userId,
				},
			}).catch((err) =>
				console.error("[Notification Error] SETTLEMENT_RECEIVED:", err),
			);
		}

		return {
			settlements,
			totalInPaymentCurrency:
				Math.round(totalInPaymentCurrency * 100) / 100,
			paymentCurrency: input.paymentCurrency,
			requiresPayeeConfirmation: !isNonUserRecipient,
		};
	}

	/**
	 * Asserts the current user has a shared financial relationship with the
	 * given participant (at least one shared transaction between them).
	 */
	private async assertRelationship(ref: ParticipantRef): Promise<void> {
		if (ref.participantType === "shadow") {
			const profile = await this.db.shadowProfile.findUnique({
				where: { id: ref.participantId },
				select: { id: true },
			});
			if (!profile) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
			}
		}

		const count = await this.db.sharedTransaction.count({
			where: {
				AND: [
					{
						splitParticipants: {
							some: {
								participantType: "user",
								participantId: this.userId,
							},
						},
					},
					{
						splitParticipants: {
							some: {
								participantType: ref.participantType,
								participantId: ref.participantId,
							},
						},
					},
				],
			},
		});

		if (!count) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "No financial relationship found with this person",
			});
		}
	}
}
