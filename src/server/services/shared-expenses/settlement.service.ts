import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { convertAmount, currencyDecimals, roundMoney } from "~/lib/money";
import { db as globalDb } from "~/server/db";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import { getBestExchangeRate } from "~/server/api/routers/shared-currency";
import type { Prisma, PrismaClient, SettlementStatus } from "~prisma";
import { logAudit } from "./audit-log";
import { computeBalance, computeBalanceByProject } from "./balance";
import { reopenUnsettledPeriods } from "./billing-period-settle";
import { resolveClaimAliases } from "./identity";
import {
	allocateFullSettlement,
	reverseScopeDebtsForCurrency,
	type ScopeAllocation,
	type ScopeDebt,
	scopeDebtsForCurrency,
} from "./settlement-allocation";
import {
	describeGroupAmount,
	type GroupRow,
	groupCounterparty,
	groupRoles,
	groupRows,
	summarizeGroup,
} from "./settlement-groups";
import { type ParticipantRef, sameParticipant } from "./types";

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

/** Marks a settlement the payee recorded themselves ("they paid me"). */
export const RECORDED_BY_PAYEE_REASON =
	"Recorded by the payee as a payment received";

interface SettlementSides {
	payer: ParticipantRef;
	payee: ParticipantRef;
	/** The current user is the payee and is recording a payment received. */
	recordedByPayee: boolean;
}

/**
 * Confirmation state of a new settlement row.
 * - Recorded by the payee: FINALIZED at once. The payee is the one whose
 *   claim shrinks, so their own record needs no further confirmation, and
 *   the payer only owes less. confirmedByPayer stays false: the payer did not
 *   act.
 * - Paid to a ghost/guest: FINALIZED at once (they can never confirm).
 * - Paid to a registered user: PROPOSED until that user confirms or rejects.
 */
function confirmationFor(sides: SettlementSides, now: Date) {
	if (sides.recordedByPayee) {
		return {
			confirmedByPayer: false,
			confirmedByPayee: true,
			status: "FINALIZED" as const,
			settledAt: now,
			autoConfirmedReason: RECORDED_BY_PAYEE_REASON,
			auditAction: "settlement_recorded_by_payee",
		};
	}
	if (sides.payee.participantType !== "user") {
		return {
			confirmedByPayer: true,
			confirmedByPayee: true,
			status: "FINALIZED" as const,
			settledAt: now,
			autoConfirmedReason: `Recipient is a ${sides.payee.participantType} and cannot confirm`,
			auditAction: "settlement_auto_confirmed",
		};
	}
	return {
		confirmedByPayer: true,
		confirmedByPayee: false,
		status: "PROPOSED" as const,
		settledAt: null,
		autoConfirmedReason: null,
		auditAction: "settlement_initiated",
	};
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

/** One settlement row to write as part of a payment group. */
interface PlannedRow {
	projectId: string | null;
	currency: string;
	amount: number;
	/** Moves no cash, see allocateFullSettlement. */
	isOffset: boolean;
	/** Goes payee -> payer: an offset against a debt the payee owes. */
	reverse: boolean;
	convertedAmount: number | null;
	convertedCurrency: string | null;
	exchangeRateUsed: number | null;
}

function cashRow(allocation: ScopeAllocation, currency: string): PlannedRow {
	return {
		projectId: allocation.projectId,
		currency,
		amount: allocation.amount,
		isOffset: false,
		reverse: false,
		convertedAmount: null,
		convertedCurrency: null,
		exchangeRateUsed: null,
	};
}

/**
 * Rows of a global settle-up in one currency: the cash rows, then the offset
 * rows when `payeeDebts` is not empty (see allocateFullSettlement).
 */
function planFullSettlementRows(
	payerDebts: ScopeDebt[],
	payeeDebts: ScopeDebt[],
	cash: number,
	currency: string,
): PlannedRow[] {
	const { cash: cashRows, payerOffsets, payeeOffsets } =
		allocateFullSettlement(payerDebts, payeeDebts, cash);
	return [
		...cashRows.map((a) => cashRow(a, currency)),
		...payerOffsets.map((a) => ({
			...cashRow(a, currency),
			isOffset: true,
		})),
		...payeeOffsets.map((a) => ({
			...cashRow(a, currency),
			isOffset: true,
			reverse: true,
		})),
	];
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

	private sides(
		other: ParticipantRef,
		direction: SettlementDirection | undefined,
	): SettlementSides {
		return direction === "incoming"
			? { payer: other, payee: this.currentUserRef, recordedByPayee: true }
			: { payer: this.currentUserRef, payee: other, recordedByPayee: false };
	}

	/**
	 * Records a settlement between the current user and `toParticipant`: either
	 * a payment the current user made ("outgoing", the default) or one they
	 * received ("incoming"). Rejects (does not record) if the amount exceeds
	 * what the payer owes the payee: over-payment would fabricate a reverse
	 * balance, and an auto-finalized record cannot be confirmed away. Partial
	 * settlements (amount <= outstanding) are still allowed.
	 * See confirmationFor for which records need the payee to confirm.
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
			await this.assertProjectInvolvement(input.projectId);
		}

		const sides = this.sides(input.toParticipant, input.direction);
		const { payer, payee } = sides;

		// projectId undefined => GLOBAL cap, payment allocated across scopes.
		// string / null => that single scope (project / direct bucket). The cap
		// MUST be computed in the same scope as the write.
		const isGlobal = input.projectId === undefined;
		const projectScope = isGlobal ? undefined : input.projectId;

		// Balance check + create + audit run in one transaction that first takes
		// the pair lock, so two concurrent payments cannot both pass the cap.
		const { settlements, paymentGroupId } = await this.db.$transaction(
			async (tx) => {
			await this.lockPair(tx, input.toParticipant);

			// computeBalance(payer, payee): negative = the payer owes the payee.
			const balanceResult = await computeBalance(
				tx as unknown as PrismaClient,
				payer,
				payee,
				{ projectScope },
			);
			const rawBalance = balanceResult.byCurrency[input.currency] ?? 0;
			const amountOwed = Math.max(0, -rawBalance);

			// Hard block over-payment: recording more than the outstanding balance
			// fabricates a reverse debt, and an auto-finalized settlement cannot be
			// confirmed or rejected away.
			if (input.amount > amountOwed + 0.01) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `This settlement of ${input.currency} ${formatAmount(input.amount, input.currency)} exceeds the outstanding balance of ${input.currency} ${formatAmount(amountOwed, input.currency)} with this person. Enter an amount up to the outstanding balance.`,
				});
			}

			// Nothing owed in this scope (and currency): there is nothing to settle.
			// Without this an amount inside the tolerance above could still be
			// recorded, e.g. stamped onto a project where this pair has no balance.
			if (amountOwed <= OWED_TOLERANCE) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `There is no outstanding ${input.currency} balance to settle with this person${typeof input.projectId === "string" ? " in this project" : ""}.`,
				});
			}

			// One row per scope. A scoped settle-up is a single row; a global one
			// is split across the per-project (and direct) debts so no scope is
			// over-paid and every view sees its share of the payment.
			const cash = Math.min(input.amount, amountOwed);
			let planned: PlannedRow[];
			if (isGlobal) {
				const byProject = await computeBalanceByProject(
					tx as unknown as PrismaClient,
					payer,
					payee,
				);
				// Paying the full global amount in this currency also cancels the
				// debts going the other way between scopes, so every project ends
				// at zero together with the global view. A partial payment never
				// offsets. Other currencies are never touched.
				const isFullPayment = input.amount >= amountOwed - OWED_TOLERANCE;
				planned = planFullSettlementRows(
					scopeDebtsForCurrency(byProject, input.currency),
					isFullPayment
						? reverseScopeDebtsForCurrency(byProject, input.currency)
						: [],
					cash,
					input.currency,
				);
			} else {
				// Within the over-payment tolerance, record at most what is owed so
				// the scope ends at zero instead of a cent of reverse debt.
				planned = [
					cashRow({ projectId: input.projectId ?? null, amount: cash }, input.currency),
				];
			}
			if (!planned.some((r) => !r.isOffset)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `There is no outstanding ${input.currency} balance to settle with this person.`,
				});
			}
			for (const row of planned) {
				if (row.isOffset) continue;
				row.convertedAmount =
					input.convertedAmount != null
						? (input.convertedAmount * row.amount) / input.amount
						: null;
				row.convertedCurrency = input.convertedCurrency ?? null;
				row.exchangeRateUsed = input.exchangeRateUsed ?? null;
			}

			return this.createPaymentGroup(tx, sides, planned, {
				now: new Date(),
				paymentMethod: input.paymentMethod ?? null,
				note: input.note ?? null,
			});
			},
		);
		// The first cash row stands for the payment (offset rows follow it).
		const settlement = settlements.find((s) => !s.isOffset) ?? settlements[0]!;

		// Notify the other person if they're a registered user (outside
		// transaction, best-effort). One notification for the whole group.
		if (input.toParticipant.participantType === "user") {
			await this.notifySettlementRecorded(
				sides,
				`${input.currency} ${formatAmount(input.amount, input.currency)}`,
				{ settlementId: settlement.id, paymentGroupId },
			);
		}

		return {
			settlement,
			settlements,
			warning: null as string | null,
			requiresPayeeConfirmation: settlement.status === "PROPOSED",
		};
	}

	/**
	 * Tells the registered counterparty about a new settlement: the payee that
	 * a payment was sent (to confirm), or the payer that the payee recorded
	 * receiving their payment.
	 */
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
		const now = new Date();
		const { lead, rows } = await this.db.$transaction(async (tx) => {
			const { lead, rows } = await this.loadGroup(tx, settlementId);
			const roles = groupRoles(rows, this.userId);

			if (!roles.isParty) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the payee can confirm this settlement",
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
					message: "Only the payee can confirm this settlement",
				});
			}

			await this.updateGroup(tx, rows, ["PROPOSED"], {
				confirmedByPayer: true,
				confirmedByPayee: true,
				status: "FINALIZED",
				settledAt: now,
			});
			await this.logGroupAction(tx, rows, {
				action: "SETTLED",
				context: "settlement_confirmed",
			});
			return { lead, rows };
		});

		// Notify the person who recorded it, once for the whole group.
		const other = groupCounterparty(rows, this.userId);
		if (other?.participantType === "user") {
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

		return {
			...lead,
			confirmedByPayer: true,
			confirmedByPayee: true,
			status: "FINALIZED" as const,
			settledAt: now,
		};
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
			await this.logGroupAction(tx, rows, {
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
			await this.logGroupAction(tx, rows, {
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

			await this.updateGroup(tx, rows, ["PROPOSED"], {
				status: "REJECTED",
				rejectedAt: now,
				rejectedReason: reason ?? null,
			});
			await this.logGroupAction(tx, rows, {
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
	 *
	 * In the global scope, `offsetAmount` is how much of the opposite-direction
	 * project debts in that currency a full settle-up also cancels (see
	 * allocateFullSettlement). 0 when every scope points the same way.
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
			include: { project: { select: { id: true, name: true } } },
			orderBy: { initiatedAt: "desc" },
		});

		return groupRows(settlements).map((group) => {
			const lead = group.find((r) => !r.isOffset) ?? group[0]!;
			const roles = groupRoles(group, this.userId);
			const summary = summarizeGroup(group, this.userId);
			const isPending = roles.status === "PROPOSED";

			let canRemind = false;
			if (roles.recordedByMe && isPending) {
				const reminder = groupReminderState(group);
				canRemind = reminder.count < 3;
				if (reminder.sentAt) {
					const hoursSince = (Date.now() - reminder.sentAt.getTime()) / (1000 * 60 * 60);
					if (hoursSince < 24) canRemind = false;
				}
			}

			return {
				id: lead.id,
				paymentGroupId: lead.paymentGroupId,
				kind: summary.kind,
				amount: summary.amount,
				currency: summary.currency,
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
				status: roles.status === "REJECTED"
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
		await this.assertRelationship(ref);
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
	 * cash) so every project scope ends at zero. Handled like a payment the
	 * current user sends: a registered user confirms or rejects it (it changes
	 * their project balances, and billing periods depend on those), a ghost
	 * or guest is auto-confirmed. Same pair lock as a payment.
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
		await this.assertRelationship(input.toParticipant);

		const sides = this.sides(input.toParticipant, "outgoing");

		const { settlements, paymentGroupId, offset } = await this.db.$transaction(
			async (tx) => {
				await this.lockPair(tx, input.toParticipant);
				const byProject = await computeBalanceByProject(
					tx as unknown as PrismaClient,
					sides.payer,
					sides.payee,
				);
				const option = squareUpCandidates(byProject).find(
					(o) => o.currency === input.currency,
				);
				if (!option) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `There are no ${input.currency} project balances to square up with this person.`,
					});
				}

				// From my side: negative = I owe in that scope (row me -> them),
				// positive = they owe there (offset row them -> me).
				const rows: PlannedRow[] = option.scopes.map((scope) => ({
					...cashRow(
						{ projectId: scope.projectId, amount: Math.abs(scope.balance) },
						input.currency,
					),
					isOffset: true,
					reverse: scope.balance > 0,
				}));
				const created = await this.createPaymentGroup(tx, sides, rows, {
					now: new Date(),
					paymentMethod: null,
					note: null,
					squareUp: true,
				});
				return { ...created, offset: option.amount };
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
	 * Settles ALL outstanding balances with a person at once.
	 * Creates one settlement per currency, atomically in a single transaction.
	 * Each settlement records the converted amount in the payment currency.
	 *
	 * Only settles currencies where the payer owes the payee. With direction
	 * "incoming" the other person is the payer: the current user records that
	 * they were paid everything they were owed.
	 *
	 * A currency that cannot be converted to the payment currency (no exchange
	 * rate available) is excluded and reported in `skipped` rather than recorded
	 * with an unconverted amount. If nothing can be converted, throws.
	 */
	async settleAll(input: {
		toParticipant: ParticipantRef;
		/** See InitiateSettlementInput.direction. */
		direction?: SettlementDirection;
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
			await this.assertProjectInvolvement(input.projectId);
		}

		const sides = this.sides(input.toParticipant, input.direction);
		const { payer, payee } = sides;

		// See initiateSettlement: undefined => GLOBAL balances, each currency's
		// payment allocated across the per-scope debts; string / null => that one
		// scope (project / direct bucket), stamped on every row.
		const isGlobal = input.projectId === undefined;
		const projectScope = isGlobal ? undefined : input.projectId;

		// The balance read, the cap and the writes all run in one transaction
		// that first takes the pair lock, so a concurrent payment between the
		// same two people cannot also pass the balance check.
		const { settlements, paymentGroupId, totalInPaymentCurrency, skipped } =
			await this.db.$transaction(async (tx) => {
				await this.lockPair(tx, input.toParticipant);

				// Compute all per-currency balances IN THE SAME SCOPE as the writes
				// below, from the payer's side.
				const balanceResult = await computeBalance(
					tx as unknown as PrismaClient,
					payer,
					payee,
					{ projectScope },
				);

				// Filter to currencies where the payer owes the payee (negative balance)
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
						tx as unknown as PrismaClient,
						currency,
						now,
					);
					if (result) rateMap.set(currency, result.rate);
				}

				// Also get rate for payment currency (needed for cross-currency conversion)
				if (input.paymentCurrency !== "USD" && !rateMap.has(input.paymentCurrency)) {
					const result = await getBestExchangeRate(
						tx as unknown as PrismaClient,
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
							const converted = convertAmount(
								amount,
								entry.currency,
								sourceRate,
								input.paymentCurrency,
								targetRate,
							);
							return roundMoney(converted, input.paymentCurrency);
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
				// debts (same rules as a single global settlement). It pays the full
				// global amount in every currency it settles, so each currency also
				// gets its offset rows (allocateFullSettlement): every project ends at
				// zero. Offsets never cross currencies.
				const byProject = isGlobal
					? await computeBalanceByProject(
							tx as unknown as PrismaClient,
							payer,
							payee,
						)
					: null;
				const plan = (currency: string, amount: number): PlannedRow[] =>
					byProject
						? planFullSettlementRows(
								scopeDebtsForCurrency(byProject, currency),
								reverseScopeDebtsForCurrency(byProject, currency),
								amount,
								currency,
							)
						: [cashRow({ projectId: input.projectId ?? null, amount }, currency)];

				const planned: PlannedRow[] = [];
				let totalInPaymentCurrency = 0;

				for (const entry of settleable) {
					const rows = plan(entry.currency, entry.amount);
					const cashRows = rows.filter((r) => !r.isOffset);
					// Converted amounts are rounded per row; the last row takes the
					// rounding remainder so the rows add up to the converted total.
					const convertedTotal = entry.convert
						? entry.convert(entry.amount)
						: null;
					let convertedSoFar = 0;
					for (const [i, row] of cashRows.entries()) {
						let convertedAmount: number | null = null;
						if (entry.convert && convertedTotal !== null) {
							convertedAmount =
								i === cashRows.length - 1
									? roundMoney(
											convertedTotal - convertedSoFar,
											input.paymentCurrency,
										)
									: entry.convert(row.amount);
							convertedSoFar += convertedAmount;
						}
						row.convertedAmount = convertedAmount;
						row.convertedCurrency = entry.convert
							? input.paymentCurrency
							: null;
						row.exchangeRateUsed = entry.exchangeRateUsed;
						totalInPaymentCurrency += convertedAmount ?? row.amount;
					}
					planned.push(...rows);
				}

				const { paymentGroupId, settlements: created } =
					await this.createPaymentGroup(tx, sides, planned, {
						now,
						paymentMethod: input.paymentMethod ?? null,
						note: input.note ?? null,
						batch: true,
					});
				const settlements = created.map((settlement) => ({
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

				return { settlements, paymentGroupId, totalInPaymentCurrency, skipped };
			});

		// Send a single notification for the batch
		const settledCurrencyCount = new Set(
			settlements.filter((s) => !s.isOffset).map((s) => s.currency),
		).size;
		if (input.toParticipant.participantType === "user") {
			const formattedTotal = `${input.paymentCurrency} ${formatAmount(totalInPaymentCurrency, input.paymentCurrency)}`;
			await this.notifySettlementRecorded(
				sides,
				settledCurrencyCount > 1
					? `${formattedTotal} across ${settledCurrencyCount} currencies`
					: formattedTotal,
				{ settlementIds: settlements.map((s) => s.id), paymentGroupId },
			);
		}

		return {
			settlements,
			paymentGroupId,
			skipped,
			totalInPaymentCurrency: roundMoney(
				totalInPaymentCurrency,
				input.paymentCurrency,
			),
			paymentCurrency: input.paymentCurrency,
			requiresPayeeConfirmation:
				confirmationFor(sides, new Date()).status === "PROPOSED",
		};
	}

	/**
	 * Writes the rows of one settle-up call as a payment group (one shared
	 * paymentGroupId) and logs one CREATED activity entry per project and
	 * currency of the group, so each project feed shows its own part once.
	 * Offset rows going payee -> payer get their confirmation flags swapped:
	 * the recorder has agreed to every row, see settlement-groups.ts.
	 */
	private async createPaymentGroup(
		tx: Prisma.TransactionClient,
		sides: SettlementSides,
		rows: PlannedRow[],
		opts: {
			now: Date;
			paymentMethod: string | null;
			note: string | null;
			batch?: boolean;
			squareUp?: boolean;
		},
	) {
		const paymentGroupId = randomUUID();
		const { auditAction, ...confirmation } = confirmationFor(sides, opts.now);
		const { payer, payee } = sides;

		const settlements: Prisma.SettlementGetPayload<object>[] = [];
		for (const row of rows) {
			const [from, to] = row.reverse ? [payee, payer] : [payer, payee];
			const settlement = await tx.settlement.create({
				data: {
					fromParticipantType: from.participantType,
					fromParticipantId: from.participantId,
					toParticipantType: to.participantType,
					toParticipantId: to.participantId,
					amount: row.amount,
					currency: row.currency,
					projectId: row.projectId,
					convertedAmount: row.convertedAmount,
					convertedCurrency: row.convertedCurrency,
					exchangeRateUsed: row.exchangeRateUsed,
					paymentMethod: row.isOffset ? null : opts.paymentMethod,
					note: opts.note,
					...confirmation,
					...(row.reverse
						? {
								confirmedByPayer: confirmation.confirmedByPayee,
								confirmedByPayee: confirmation.confirmedByPayer,
							}
						: {}),
					initiatedAt: opts.now,
					paymentGroupId,
					isOffset: row.isOffset,
				},
			});
			settlements.push(settlement);
		}

		const cashTotal = new Map<string, number>();
		for (const row of rows) {
			if (row.isOffset) continue;
			cashTotal.set(row.currency, (cashTotal.get(row.currency) ?? 0) + row.amount);
		}

		const scopes = new Map<string, number[]>();
		rows.forEach((row, i) => {
			const key = `${row.projectId ?? ""}|${row.currency}`;
			const list = scopes.get(key) ?? [];
			list.push(i);
			scopes.set(key, list);
		});
		for (const indexes of scopes.values()) {
			const first = rows[indexes[0]!]!;
			const cash = indexes.reduce(
				(sum, i) => sum + (rows[i]!.isOffset ? 0 : rows[i]!.amount),
				0,
			);
			const offsetAmount = indexes.reduce(
				(sum, i) => sum + (rows[i]!.isOffset ? rows[i]!.amount : 0),
				0,
			);
			const total = cashTotal.get(first.currency) ?? 0;
			await logAudit(tx, {
				actor: this.currentUserRef,
				action: "CREATED",
				targetType: "SETTLEMENT",
				targetId: settlements[indexes[0]!]!.id,
				changes: {
					amount: cash,
					currency: first.currency,
					...(sides.recordedByPayee
						? {
								fromParticipantType: payer.participantType,
								fromParticipantId: payer.participantId,
							}
						: {}),
					toParticipantType: payee.participantType,
					toParticipantId: payee.participantId,
					projectId: first.projectId,
					paymentGroupId,
					settlementIds: indexes.map((i) => settlements[i]!.id),
					...(total > cash + OWED_TOLERANCE ? { allocatedFromTotal: total } : {}),
					...(offsetAmount > 0 ? { offsetAmount } : {}),
					...(opts.squareUp ? { squareUp: true } : {}),
					...(opts.batch ? { batchSettlement: true } : {}),
				},
				context: { action: auditAction, ...(opts.batch ? { batch: true } : {}) },
				projectId: first.projectId ?? undefined,
			});
		}

		return { paymentGroupId, settlements };
	}

	/**
	 * Loads every row of the payment group `settlementId` belongs to (just
	 * that row for a legacy payment without a group).
	 */
	private async loadGroup(
		db: Pick<PrismaClient, "settlement"> | Prisma.TransactionClient,
		settlementId: string,
	) {
		const lead = await db.settlement.findUnique({ where: { id: settlementId } });
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

	/**
	 * Applies `data` to every row of a group, only while each row still has
	 * one of `fromStatuses`. If another request changed the group first, the
	 * whole action fails rather than touching part of the group.
	 */
	private async updateGroup(
		tx: Prisma.TransactionClient,
		rows: Array<{ id: string }>,
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
				message: "This payment was changed in the meantime. Refresh and try again.",
			});
		}
	}

	private async deleteGroup(
		tx: Prisma.TransactionClient,
		rows: Array<{ id: string }>,
		fromStatuses: SettlementStatus[],
	) {
		const { count } = await tx.settlement.deleteMany({
			where: { id: { in: rows.map((r) => r.id) }, status: { in: fromStatuses } },
		});
		if (count !== rows.length) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "This payment was changed in the meantime. Refresh and try again.",
			});
		}
	}

	/** One audit entry for an action on a whole group. */
	private async logGroupAction(
		tx: Prisma.TransactionClient | PrismaClient,
		rows: GroupRow[],
		params: {
			action: "SETTLED" | "REJECTED" | "DELETED";
			context: string;
			changes?: Record<string, unknown>;
		},
	) {
		const lead = rows.find((r) => !r.isOffset) ?? rows[0]!;
		const summary = summarizeGroup(rows, this.userId);
		const projectIds = [...new Set(rows.map((r) => r.projectId ?? null))];
		await logAudit(tx, {
			actor: this.currentUserRef,
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

	/**
	 * Serializes settlement writes between the current user and `other`. Taken
	 * as the first statement of the transaction that reads the balance and
	 * writes the settlement rows, it makes a second concurrent payment between
	 * the same two people wait until the first commits, so its balance read
	 * sees the first payment and the over-payment cap holds. The key is the
	 * unordered pair, so payments in either direction share one lock.
	 * Transaction-scoped: released automatically on commit or rollback.
	 */
	private async lockPair(
		tx: Pick<PrismaClient, "$executeRaw">,
		other: ParticipantRef,
	): Promise<void> {
		const pairKey = [
			`${this.currentUserRef.participantType}:${this.currentUserRef.participantId}`,
			`${other.participantType}:${other.participantId}`,
		]
			.sort()
			.join("|");
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('settlement-pair'), hashtext(${pairKey}))`;
	}

	/**
	 * A client-supplied projectId must name a project the current user is or
	 * was part of: a current participant, or the payer / a split member of one
	 * of its expenses (claim aliases count). Otherwise a caller could stamp
	 * settlements onto an arbitrary project.
	 *
	 * Current membership alone is not required: removing someone from a project
	 * deletes their membership row but keeps their expenses and balances, and
	 * they must still be able to settle those. The counterparty is covered by
	 * the scoped balance check in initiateSettlement/settleAll: a nonzero
	 * balance between the two in this project only exists if both have
	 * history in it.
	 */
	private async assertProjectInvolvement(projectId: string): Promise<void> {
		const { aliasesByKey } = await resolveClaimAliases(this.db, [
			this.currentUserRef,
		]);
		const myRefs = aliasesByKey.get(
			`${this.currentUserRef.participantType}:${this.currentUserRef.participantId}`,
		) ?? [this.currentUserRef];
		const refConds = myRefs.map((r) => ({
			participantType: r.participantType,
			participantId: r.participantId,
		}));

		const members = await this.db.projectParticipant.findMany({
			where: { projectId, OR: refConds },
			select: { id: true },
			take: 1,
		});
		if (members.length > 0) return;

		const involvedExpenses = await this.db.sharedTransaction.count({
			where: {
				projectId,
				OR: [
					...refConds.map((r) => ({
						paidByType: r.participantType,
						paidById: r.participantId,
					})),
					...refConds.map((r) => ({ splitParticipants: { some: r } })),
				],
			},
		});
		if (involvedExpenses > 0) return;

		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You are not part of this project",
		});
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
