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
import { computeBalance, computeBalanceByProject } from "./balance";
import { resolveClaimAliases } from "./identity";
import {
	allocateAcrossScopes,
	type ScopeAllocation,
	scopeDebtsForCurrency,
} from "./settlement-allocation";
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
	/**
	 * Scope of this settlement.
	 * - string: that project. The over-payment cap uses the per-project balance
	 *   and the row is stamped with this projectId. Both parties must be
	 *   participants of the project.
	 * - null: the direct (project-less) bucket only.
	 * - omitted: the GLOBAL view. The cap uses the global balance and the payment
	 *   is allocated across the pair's per-scope balances (one row per scope,
	 *   see allocateAcrossScopes) so every project view and the global view
	 *   agree.
	 */
	projectId?: string | null;
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
	 * Rejects (does not record) if the settlement exceeds the current balance owed:
	 * over-payment would fabricate a reverse balance against the recipient, and for
	 * non-user recipients that record is irreversible. Partial settlements
	 * (amount <= outstanding) are still allowed.
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
		if (typeof input.projectId === "string") {
			await this.assertProjectMembership(input.projectId, input.toParticipant);
		}

		const isNonUserRecipient = input.toParticipant.participantType !== "user";

		// projectId undefined => GLOBAL cap, payment allocated across scopes.
		// string / null => that single scope (project / direct bucket). The cap
		// MUST be computed in the same scope as the write.
		const isGlobal = input.projectId === undefined;
		const projectScope = isGlobal ? undefined : input.projectId;

		// Wrap balance check + create + audit in a transaction to prevent
		// concurrent settlements from racing past the balance check.
		const { settlements } = await this.db.$transaction(async (tx) => {
			// computeBalance(currentUser, other): positive = other owes us, negative = we owe other.
			const balanceResult = await computeBalance(
				tx as unknown as PrismaClient,
				this.currentUserRef,
				input.toParticipant,
				{ projectScope },
			);
			const rawBalance = balanceResult.byCurrency[input.currency] ?? 0;
			const amountOwed = Math.max(0, -rawBalance);

			// Hard block over-payment: recording more than the outstanding balance
			// fabricates a reverse debt against the recipient, and for non-user
			// recipients the settlement auto-finalizes and cannot be reversed.
			if (input.amount > amountOwed + 0.01) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `This settlement of ${input.currency} ${input.amount.toFixed(2)} exceeds the outstanding balance of ${input.currency} ${amountOwed.toFixed(2)} with this person. Enter an amount up to the outstanding balance.`,
				});
			}

			// One row per scope. A scoped settle-up is a single row; a global one
			// is split across the per-project (and direct) debts so no scope is
			// over-paid and every view sees its share of the payment.
			let allocations: ScopeAllocation[];
			if (isGlobal) {
				const byProject = await computeBalanceByProject(
					tx as unknown as PrismaClient,
					this.currentUserRef,
					input.toParticipant,
				);
				allocations = allocateAcrossScopes(
					scopeDebtsForCurrency(byProject, input.currency),
					input.amount,
				);
			} else {
				allocations = [
					{ projectId: input.projectId ?? null, amount: input.amount },
				];
			}

			const now = new Date();
			const settlements = [];
			for (const allocation of allocations) {
				const ratio = allocation.amount / input.amount;
				const settlement = await tx.settlement.create({
					data: {
						fromParticipantType: this.currentUserRef.participantType,
						fromParticipantId: this.currentUserRef.participantId,
						toParticipantType: input.toParticipant.participantType,
						toParticipantId: input.toParticipant.participantId,
						amount: allocation.amount,
						currency: input.currency,
						projectId: allocation.projectId,
						convertedAmount:
							input.convertedAmount != null
								? input.convertedAmount * ratio
								: null,
						convertedCurrency: input.convertedCurrency ?? null,
						exchangeRateUsed: input.exchangeRateUsed ?? null,
						paymentMethod: input.paymentMethod ?? null,
						note: input.note ?? null,
						confirmedByPayer: true,
						// Auto-confirm for non-user recipients
						confirmedByPayee: isNonUserRecipient,
						status: isNonUserRecipient ? "FINALIZED" : "PROPOSED",
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
						amount: allocation.amount,
						currency: input.currency,
						toParticipantType: input.toParticipant.participantType,
						toParticipantId: input.toParticipant.participantId,
						projectId: allocation.projectId,
						...(allocations.length > 1
							? { allocatedFromTotal: input.amount }
							: {}),
					},
					context: {
						action: isNonUserRecipient
							? "settlement_auto_confirmed"
							: "settlement_initiated",
					},
					projectId: allocation.projectId ?? undefined,
				});

				settlements.push(settlement);
			}

			return { settlements };
		});
		const settlement = settlements[0]!;

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
			settlements,
			warning: null as string | null,
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
	 * Voids (undoes) an auto-finalized settlement whose payee is a non-user
	 * (shadow or guest). Only the payer can call this.
	 *
	 * A settlement to a shadow/guest is FINALIZED the instant it is created,
	 * because a non-user counterparty can never authenticate to confirm it. That
	 * auto-finalization is a system convenience, NOT a real agreement: no human
	 * ever accepted the payment. So a fat-fingered or wrong-person settlement
	 * would otherwise permanently rewrite a balance with no recourse — deletePending
	 * refuses finalized rows and reject requires a real user payee.
	 *
	 * This method restores that recourse: it hard-deletes the auto-finalized row,
	 * which cleanly reverses its effect because balances are recomputed from the
	 * remaining settlement rows (see computeBalance).
	 *
	 * Protected (NOT voidable) here:
	 * - A settlement whose payee is a real USER (needs mutual agreement to undo).
	 * - A settlement a real user payee actually confirmed (autoConfirmedReason is
	 *   null): genuine agreement, out of scope.
	 * - A PROPOSED settlement (use deletePendingSettlement instead).
	 */
	async voidAutoFinalizedSettlement(settlementId: string) {
		const settlement = await this.db.settlement.findUnique({
			where: { id: settlementId },
		});

		if (!settlement) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Settlement not found",
			});
		}

		// Only the payer (as the logged-in user) can void.
		if (
			settlement.fromParticipantType !== "user" ||
			settlement.fromParticipantId !== this.userId
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only the payer can void this settlement",
			});
		}

		// Payee must be a non-user (shadow or guest). A real user payee's
		// settlement can only be reversed by mutual agreement, never unilaterally.
		if (settlement.toParticipantType === "user") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message:
					"Cannot void a settlement to a registered user. It can only be reversed by mutual agreement.",
			});
		}

		// Only auto-finalized settlements are voidable: FINALIZED with an
		// autoConfirmedReason recorded (i.e. the payee never genuinely confirmed;
		// the system confirmed it because the payee cannot authenticate).
		const isAutoFinalized =
			settlement.status === "FINALIZED" &&
			settlement.confirmedByPayee &&
			settlement.autoConfirmedReason !== null;

		if (!isAutoFinalized) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Only an auto-finalized settlement can be voided",
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
				autoConfirmedReason: settlement.autoConfirmedReason,
				initiatedAt: settlement.initiatedAt.toISOString(),
			},
			context: { action: "settlement_voided" },
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
	async getSettlementPlan(ref: ParticipantRef, projectId?: string | null) {
		await this.assertRelationship(ref);

		// Scope the plan to the same scope the settle-up action will write in
		// (string => that project; null => direct bucket; omitted => GLOBAL, the
		// default for the cross-project People view).
		const balanceResult = await computeBalance(
			this.db,
			this.currentUserRef,
			ref,
			{ projectScope: projectId },
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

			// A settlement to a non-user payee (shadow/guest) is auto-finalized on
			// creation because the payee can never confirm. The payer can void that
			// (undo the recorded payment) since no real counterparty ever agreed.
			// Genuine user-confirmed settlements (autoConfirmedReason == null) stay
			// protected and are NOT voidable.
			const isNonUserPayee = s.toParticipantType !== "user";
			const canVoid =
				isPayer &&
				isNonUserPayee &&
				s.status === "FINALIZED" &&
				s.confirmedByPayee &&
				s.autoConfirmedReason !== null;

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
				canVoid,
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
	 *
	 * A currency that cannot be converted to the payment currency (no exchange
	 * rate available) is excluded and reported in `skipped` rather than recorded
	 * with an unconverted amount. If nothing can be converted, throws.
	 */
	async settleAll(input: {
		toParticipant: ParticipantRef;
		paymentCurrency: string;
		paymentMethod?: string | null;
		note?: string | null;
		projectId?: string | null;
	}) {
		if (sameParticipant(this.currentUserRef, input.toParticipant)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Cannot create a settlement with yourself",
			});
		}

		await this.assertRelationship(input.toParticipant);
		if (typeof input.projectId === "string") {
			await this.assertProjectMembership(input.projectId, input.toParticipant);
		}

		const isNonUserRecipient = input.toParticipant.participantType !== "user";

		// See initiateSettlement: undefined => GLOBAL balances, each currency's
		// payment allocated across the per-scope debts; string / null => that one
		// scope (project / direct bucket), stamped on every row.
		const isGlobal = input.projectId === undefined;
		const projectScope = isGlobal ? undefined : input.projectId;

		// Compute all per-currency balances IN THE SAME SCOPE as the writes below.
		const balanceResult = await computeBalance(
			this.db,
			this.currentUserRef,
			input.toParticipant,
			{ projectScope },
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

		// Partition the batch into convertible entries and those we must skip
		// because a rate is missing. Never fold an unconverted foreign amount into
		// the payment-currency total: that would report a settled balance the human
		// may never have actually paid.
		const skipped: Array<{ currency: string; reason: string }> = [];
		const settleable: Array<{
			currency: string;
			amount: number;
			/** Converts an amount of this currency into the payment currency. */
			convert: ((amount: number) => number) | null;
			exchangeRateUsed: number | null;
		}> = [];

		for (const entry of entries) {
			if (entry.currency === input.paymentCurrency) {
				settleable.push({
					currency: entry.currency,
					amount: entry.amount,
					convert: null,
					exchangeRateUsed: null,
				});
				continue;
			}

			// Convert via USD: source -> USD -> paymentCurrency
			const sourceRate = rateMap.get(entry.currency);
			const targetRate =
				input.paymentCurrency === "USD"
					? 1
					: rateMap.get(input.paymentCurrency);

			if (!sourceRate || !targetRate) {
				skipped.push({
					currency: entry.currency,
					reason: "no_exchange_rate",
				});
				continue;
			}

			settleable.push({
				currency: entry.currency,
				amount: entry.amount,
				convert: (amount: number) => {
					const usdAmount = toUSD(amount, entry.currency, sourceRate);
					const converted =
						input.paymentCurrency === "USD"
							? usdAmount
							: fromUSD(usdAmount, input.paymentCurrency, targetRate);
					return Math.round(converted * 100) / 100;
				},
				exchangeRateUsed: sourceRate,
			});
		}

		if (settleable.length === 0) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Could not settle: no exchange rate available to convert ${skipped
					.map((s) => s.currency)
					.join(", ")} to ${input.paymentCurrency}.`,
			});
		}

		// Global settle-all: split each currency's payment across the per-scope
		// debts (same rules as a single global settlement).
		const byProject = isGlobal
			? await computeBalanceByProject(
					this.db,
					this.currentUserRef,
					input.toParticipant,
				)
			: null;
		const allocate = (currency: string, amount: number): ScopeAllocation[] =>
			byProject
				? allocateAcrossScopes(scopeDebtsForCurrency(byProject, currency), amount)
				: [{ projectId: input.projectId ?? null, amount }];

		// Create all settlements in a single transaction
		const { settlements, totalInPaymentCurrency } =
			await this.db.$transaction(async (tx) => {
				const settlements: Array<{
					id: string;
					amount: number;
					currency: string;
					convertedAmount: number | null;
					convertedCurrency: string | null;
					projectId: string | null;
				}> = [];
				let totalInPaymentCurrency = 0;

				for (const entry of settleable) {
					for (const allocation of allocate(entry.currency, entry.amount)) {
						const convertedAmount = entry.convert
							? entry.convert(allocation.amount)
							: null;
						const convertedCurrency = entry.convert
							? input.paymentCurrency
							: null;
						totalInPaymentCurrency += convertedAmount ?? allocation.amount;

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
								amount: allocation.amount,
								currency: entry.currency,
								projectId: allocation.projectId,
								convertedAmount,
								convertedCurrency,
								exchangeRateUsed: entry.exchangeRateUsed,
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
								amount: allocation.amount,
								currency: entry.currency,
								toParticipantType:
									input.toParticipant.participantType,
								toParticipantId:
									input.toParticipant.participantId,
								projectId: allocation.projectId,
								batchSettlement: true,
							},
							context: {
								action: isNonUserRecipient
									? "settlement_auto_confirmed"
									: "settlement_initiated",
								batch: true,
							},
							projectId: allocation.projectId ?? undefined,
						});

						settlements.push({
							id: settlement.id,
							amount: Number(settlement.amount),
							currency: settlement.currency,
							convertedAmount: settlement.convertedAmount
								? Number(settlement.convertedAmount)
								: null,
							convertedCurrency: settlement.convertedCurrency,
							projectId: settlement.projectId ?? null,
						});
					}
				}

				return { settlements, totalInPaymentCurrency };
			});

		// Send a single notification for the batch
		const settledCurrencyCount = new Set(settlements.map((s) => s.currency))
			.size;
		if (input.toParticipant.participantType === "user") {
			const payerName = await resolveParticipantName("user", this.userId);
			const formattedTotal = totalInPaymentCurrency.toFixed(2);
			createNotification({
				userId: input.toParticipant.participantId,
				type: "SETTLEMENT_RECEIVED",
				title: "Settlement received",
				body:
					settledCurrencyCount > 1
						? `${payerName} sent you a settlement of ${input.paymentCurrency} ${formattedTotal} across ${settledCurrencyCount} currencies`
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
			skipped,
			totalInPaymentCurrency:
				Math.round(totalInPaymentCurrency * 100) / 100,
			paymentCurrency: input.paymentCurrency,
			requiresPayeeConfirmation: !isNonUserRecipient,
		};
	}

	/**
	 * A client-supplied projectId must name a project the current user belongs
	 * to and the counterparty participates in. Otherwise a caller could stamp
	 * settlements onto (and move the balances of) an arbitrary project.
	 * Claim aliases count: a claimed shadow's membership is its user's.
	 */
	private async assertProjectMembership(
		projectId: string,
		other: ParticipantRef,
	): Promise<void> {
		const { aliasesByKey } = await resolveClaimAliases(this.db, [
			this.currentUserRef,
			other,
		]);
		const keyOf = (r: ParticipantRef) => `${r.participantType}:${r.participantId}`;
		const myRefs = aliasesByKey.get(keyOf(this.currentUserRef)) ?? [
			this.currentUserRef,
		];
		const otherRefs = aliasesByKey.get(keyOf(other)) ?? [other];

		const members = await this.db.projectParticipant.findMany({
			where: {
				projectId,
				OR: [...myRefs, ...otherRefs].map((r) => ({
					participantType: r.participantType,
					participantId: r.participantId,
				})),
			},
			select: { participantType: true, participantId: true },
		});
		const memberKeys = new Set(members.map((m) => keyOf(m)));

		if (!myRefs.some((r) => memberKeys.has(keyOf(r)))) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "You are not a member of this project",
			});
		}
		if (!otherRefs.some((r) => memberKeys.has(keyOf(r)))) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "This person is not a participant of this project",
			});
		}
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
