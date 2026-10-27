import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient, VerificationStatus } from "~prisma";
import { getImageUrl } from "~/server/storage";
import { answerShareIn } from "./answer-share";
import { logAudit } from "./audit-log";
import { buildCallerRoleMap, deriveCanModify } from "./project-permissions";
import { removeSelfIn } from "./remove-self";
import { autoAcceptSplits } from "./split-sweep";
import type { ParticipantRef } from "./types";

type AppDb = PrismaClient;

const AUTO_ACCEPT_DAYS_DEFAULT = 7;

export function computeTransactionStatus(
	participants: { verificationStatus: VerificationStatus }[],
): "pending" | "disputed" | "active" {
	if (participants.some((p) => p.verificationStatus === "REJECTED"))
		return "disputed";
	if (participants.some((p) => p.verificationStatus === "PENDING"))
		return "pending";
	return "active";
}

function serializeDecimal(val: unknown): number {
	if (val && typeof val === "object" && "toNumber" in val) {
		return (val as { toNumber(): number }).toNumber();
	}
	return Number(val);
}

function serializeParticipant(p: {
	id: string;
	participantType: string;
	participantId: string;
	verificationStatus: VerificationStatus;
	shareAmount: unknown;
	sharePercentage: unknown;
	verifiedAt: Date | null;
	rejectionReason: string | null;
}) {
	return {
		...p,
		shareAmount: serializeDecimal(p.shareAmount),
		sharePercentage: p.sharePercentage
			? serializeDecimal(p.sharePercentage)
			: null,
	};
}

export class VerificationService {
	constructor(
		private db: AppDb,
		private actor: ParticipantRef,
	) {}

	/**
	 * Auto-accepts all PENDING SplitParticipant records for the current user
	 * that have been waiting more than `days` days.
	 *
	 * The clock starts when the split was last put up for verification, not
	 * when the expense was created: an edit either recreates the split rows
	 * (fresh createdAt) or resets them in place alongside an update of the
	 * expense row (fresh updatedAt). Requiring both to be older than the cutoff
	 * gives a re-verification after an edit its full window, even on an old
	 * expense.
	 *
	 * TODO: Move this to a proper scheduled job. For v1, called at the start of
	 * getQueue() so stale items are cleaned up whenever the user checks their queue.
	 */
	async findAndAutoAcceptExpired(
		days = AUTO_ACCEPT_DAYS_DEFAULT,
	): Promise<number> {
		const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

		const expired = await this.db.splitParticipant.findMany({
			where: {
				participantType: this.actor.participantType,
				participantId: this.actor.participantId,
				verificationStatus: "PENDING",
				createdAt: { lt: cutoff },
				transaction: {
					updatedAt: { lt: cutoff },
				},
			},
			include: {
				transaction: { select: { projectId: true } },
			},
		});

		if (expired.length === 0) return 0;

		const now = new Date();

		await this.runInTransaction((tx) =>
			autoAcceptSplits(tx, expired, days, now),
		);

		return expired.length;
	}

	/**
	 * Returns all pending verification items for the current user, with full
	 * transaction context so the frontend can render the queue without
	 * additional API calls.
	 *
	 * Sorted by transaction date descending (most recent first).
	 */
	async getQueue() {
		// TODO: Move to a scheduled job. For now, run cleanup on every queue load.
		await this.findAndAutoAcceptExpired();

		const participants = await this.db.splitParticipant.findMany({
			where: {
				participantType: this.actor.participantType,
				participantId: this.actor.participantId,
				verificationStatus: "PENDING",
			},
			include: {
				transaction: {
					include: {
						category: {
							select: { id: true, name: true, color: true, icon: true },
						},
						project: {
							select: { id: true, name: true },
						},
						splitParticipants: true,
					},
				},
			},
			orderBy: {
				transaction: { date: "desc" },
			},
		});

		// Batch-resolve user info for creators/payers so the frontend
		// can render without additional calls.
		const userIds = new Set<string>();
		for (const sp of participants) {
			if (sp.transaction.createdByType === "user")
				userIds.add(sp.transaction.createdById);
			if (sp.transaction.paidByType === "user")
				userIds.add(sp.transaction.paidById);
		}

		// Fetch user info and caller's project roles in parallel
		const projectIds = [
			...new Set(
				participants
					.map((sp) => sp.transaction.projectId)
					.filter((id): id is string => id !== null),
			),
		];

		const [users, callerRoleMap] = await Promise.all([
			userIds.size > 0
				? this.db.user.findMany({
						where: { id: { in: [...userIds] } },
						select: { id: true, name: true, username: true, image: true },
					})
				: Promise.resolve([]),
			buildCallerRoleMap(this.db, [this.actor], projectIds),
		]);

		const userMap = new Map(users.map((u) => [u.id, u]));

		return participants.map((sp) => {
			const txn = sp.transaction;
			const isCreator =
				txn.createdByType === this.actor.participantType &&
				txn.createdById === this.actor.participantId;
			const canModify = deriveCanModify({
				isLocked: txn.isLocked,
				projectId: txn.projectId,
				isCreator,
				roleMap: callerRoleMap,
			});
			const canEdit = canModify;
			const canDelete = canModify;
			return {
				participantId: sp.id,
				shareAmount: serializeDecimal(sp.shareAmount),
				verificationStatus: sp.verificationStatus,
				hasUnseenChanges: sp.hasUnseenChanges,
				canEdit,
				canDelete,
				transaction: {
					id: txn.id,
					description: txn.description,
					amount: serializeDecimal(txn.amount),
					currency: txn.currency,
					date: txn.date,
					category: txn.category,
					projectId: txn.projectId,
					projectName: txn.project?.name ?? null,
					isLocked: txn.isLocked,
					createdByType: txn.createdByType,
					createdById: txn.createdById,
					createdByUser:
						txn.createdByType === "user"
							? (userMap.get(txn.createdById) ?? null)
							: null,
					paidByType: txn.paidByType,
					paidById: txn.paidById,
					paidByUser:
						txn.paidByType === "user"
							? (userMap.get(txn.paidById) ?? null)
							: null,
					computedStatus: computeTransactionStatus(txn.splitParticipants),
					splitParticipants: txn.splitParticipants.map(serializeParticipant),
				},
			};
		});
	}

	/**
	 * Bulk-accept multiple pending shared transactions in a single transaction.
	 * Skips already-accepted items (idempotent). Returns the count of newly accepted items.
	 */
	async bulkAccept(txnIds: string[]): Promise<{ accepted: number }> {
		if (txnIds.length === 0) return { accepted: 0 };

		return await this.runInTransaction(async (tx) => {
			// Find all the caller's PENDING split participants for these transactions
			const pending = await tx.splitParticipant.findMany({
				where: {
					participantType: this.actor.participantType,
					participantId: this.actor.participantId,
					verificationStatus: "PENDING",
					transactionId: { in: txnIds },
				},
				include: {
					transaction: { select: { id: true, projectId: true } },
				},
			});

			if (pending.length === 0) return { accepted: 0 };

			const now = new Date();
			await tx.splitParticipant.updateMany({
				where: { id: { in: pending.map((sp) => sp.id) } },
				data: { verificationStatus: "ACCEPTED", verifiedAt: now },
			});

			// Log audit for each
			for (const sp of pending) {
				await logAudit(tx, {
					actor: this.actor,
					action: "VERIFIED",
					targetType: "SHARED_TRANSACTION",
					targetId: sp.transactionId,
					changes: {
						participantId: sp.id,
						participantType: sp.participantType,
						participantRef: sp.participantId,
						bulkAccept: true,
					},
					projectId: sp.transaction.projectId ?? undefined,
				});
			}

			return { accepted: pending.length };
		});
	}

	/**
	 * Accept a pending shared transaction.
	 *
	 * If already accepted/auto_accepted, returns the current state without error (idempotent).
	 * After accepting, derives the transaction's computed status from all participants.
	 */
	async accept(txnId: string) {
		return await this.runInTransaction(async (tx) => {
			const { txn } = await answerShareIn(tx, this.actor, txnId, "accept");
			return buildTransactionResult(txn);
		});
	}

	/**
	 * Reject a pending shared transaction.
	 *
	 * Stores optional rejection reason. Returns a rejectionPendingNotification
	 * flag so Chunk 3D (notifications) can pick it up.
	 */
	async reject(txnId: string, reason?: string) {
		return await this.runInTransaction(async (tx) => {
			const { txn, changed } = await answerShareIn(
				tx,
				this.actor,
				txnId,
				"reject",
				reason,
			);
			// Include creator info and a flag so the notification system can send
			// the rejection notice to the creator; answering again sends nothing.
			return buildTransactionResult(txn, {
				creatorId: txn.createdById,
				creatorType: txn.createdByType,
				rejectionPendingNotification: changed,
			});
		});
	}

	/**
 * Remove the caller's own split from a shared transaction ("Remove me").
 *
 * YNAB-style: deletes ONLY the caller's own SplitParticipant row. Does not
 * delete other participants' splits and does not delete the transaction.
 * The remaining shares are intentionally left as-is, the unassigned amount
 * becomes the payer's own cost. Pairwise balances recompute from the surviving
 * split rows (see shared-expenses/balance.ts); the group views charge the gap
 * to the payer explicitly so their balances still add up to zero.
 *
 * Guards:
 * - Caller must actually be a participant on the transaction.
 * - Forbidden when locked (settled), a correction, or with corrections.
 * - When the caller's share is already paid (settlements recorded against
 *   it) or offset by other expenses, removing it would leave the payer
 *   owing the caller. That needs `confirmBalanceChange`. Erasing a share
 *   the caller still owes is the point of "Remove me" and needs no
 *   confirmation.
 */
	async removeSelf(
		txnId: string,
		confirmBalanceChange = false,
	): Promise<{ success: true }> {
		return await this.runInTransaction(async (tx) => {
			await removeSelfIn(tx, this.actor, txnId, confirmBalanceChange);
			return { success: true as const };
		});
	}

	/**
	 * Returns all transactions created by the current user where at least one
	 * other participant still has a PENDING verification status.
	 *
	 * Results are grouped by participant so the caller can see "who is slacking".
	 */
	async getOutgoingPending() {
		// Find split participants that are PENDING on transactions we created,
		// excluding ourselves (we auto-accept our own).
		const pendingParticipants = await this.db.splitParticipant.findMany({
			where: {
				verificationStatus: "PENDING",
				transaction: {
					createdByType: this.actor.participantType,
					createdById: this.actor.participantId,
				},
				NOT: {
					participantType: this.actor.participantType,
					participantId: this.actor.participantId,
				},
			},
			include: {
				transaction: {
					select: {
						id: true,
						description: true,
						amount: true,
						currency: true,
						date: true,
						createdAt: true,
						projectId: true,
						project: { select: { id: true, name: true } },
					},
				},
			},
			orderBy: { transaction: { date: "desc" } },
		});

		if (pendingParticipants.length === 0) return [];

		// Batch-resolve participant identities
		const uniqueRefs = Array.from(
			new Map(
				pendingParticipants.map((sp) => [
					`${sp.participantType}:${sp.participantId}`,
					{
						participantType: sp.participantType,
						participantId: sp.participantId,
					},
				]),
			).values(),
		);

		const userIds = uniqueRefs
			.filter((r) => r.participantType === "user")
			.map((r) => r.participantId);
		const shadowIds = uniqueRefs
			.filter((r) => r.participantType === "shadow")
			.map((r) => r.participantId);
		const guestIds = uniqueRefs
			.filter((r) => r.participantType === "guest")
			.map((r) => r.participantId);

		const [users, shadows, guests] = await Promise.all([
			userIds.length > 0
				? this.db.user.findMany({
						where: { id: { in: userIds } },
						select: {
							id: true,
							name: true,
							username: true,
							image: true,
							avatarPath: true,
						},
					})
				: [],
			shadowIds.length > 0
				? this.db.shadowProfile.findMany({
						where: { id: { in: shadowIds } },
						select: { id: true, name: true },
					})
				: [],
			guestIds.length > 0
				? this.db.guestSession.findMany({
						where: { id: { in: guestIds } },
						select: { id: true, name: true },
					})
				: [],
		]);

		const nameMap = new Map<
			string,
			{ name: string; avatarUrl: string | null }
		>();
		for (const u of users) {
			nameMap.set(`user:${u.id}`, {
				name: u.name ?? u.username ?? "Unknown",
				avatarUrl: u.avatarPath
					? getImageUrl(u.avatarPath)
					: (u.image ?? null),
			});
		}
		for (const s of shadows) {
			nameMap.set(`shadow:${s.id}`, { name: s.name, avatarUrl: null });
		}
		for (const g of guests) {
			nameMap.set(`guest:${g.id}`, {
				name: g.name ?? "Guest",
				avatarUrl: null,
			});
		}

		// Group by participant
		const grouped = new Map<
			string,
			{
				participantType: string;
				participantId: string;
				name: string;
				avatarUrl: string | null;
				transactions: Array<{
					id: string;
					description: string;
					amount: number;
					currency: string;
					date: Date;
					createdAt: Date;
					projectName: string | null;
				}>;
			}
		>();

		for (const sp of pendingParticipants) {
			const key = `${sp.participantType}:${sp.participantId}`;
			if (!grouped.has(key)) {
				const identity = nameMap.get(key);
				grouped.set(key, {
					participantType: sp.participantType,
					participantId: sp.participantId,
					name: identity?.name ?? "Unknown",
					avatarUrl: identity?.avatarUrl ?? null,
					transactions: [],
				});
			}
			grouped.get(key)!.transactions.push({
				id: sp.transaction.id,
				description: sp.transaction.description,
				amount: serializeDecimal(sp.transaction.amount),
				currency: sp.transaction.currency,
				date: sp.transaction.date,
				createdAt: sp.transaction.createdAt,
				projectName: sp.transaction.project?.name ?? null,
			});
		}

		// Sort groups: most pending first, then by oldest pending date
		return Array.from(grouped.values()).sort((a, b) => {
			if (b.transactions.length !== a.transactions.length) {
				return b.transactions.length - a.transactions.length;
			}
			const aOldest = Math.min(
				...a.transactions.map((t) => t.createdAt.getTime()),
			);
			const bOldest = Math.min(
				...b.transactions.map((t) => t.createdAt.getTime()),
			);
			return aOldest - bOldest; // older first = more "slacking"
		});
	}

	private async runInTransaction<T>(
		callback: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		return await this.db.$transaction(async (tx) => {
			await tx.$executeRaw`SELECT set_config('app.current_user_id', ${this.actor.participantId}, true),
			                            set_config('role', 'retrospend_app', true)`;
			return await callback(tx);
		});
	}
}

function buildTransactionResult(
	txn: {
		id: string;
		description: string;
		amount: unknown;
		currency: string;
		date: Date;
		projectId: string | null;
		createdByType: string;
		createdById: string;
		splitParticipants: Array<{
			id: string;
			participantType: string;
			participantId: string;
			verificationStatus: VerificationStatus;
			shareAmount: unknown;
			sharePercentage: unknown;
			verifiedAt: Date | null;
			rejectionReason: string | null;
		}>;
	},
	extra?: {
		creatorId?: string;
		creatorType?: string;
		rejectionPendingNotification?: boolean;
	},
) {
	return {
		id: txn.id,
		description: txn.description,
		amount: serializeDecimal(txn.amount),
		currency: txn.currency,
		date: txn.date,
		projectId: txn.projectId,
		createdByType: txn.createdByType,
		createdById: txn.createdById,
		computedStatus: computeTransactionStatus(txn.splitParticipants),
		splitParticipants: txn.splitParticipants.map(serializeParticipant),
		...(extra?.rejectionPendingNotification !== undefined && {
			// Chunk 3D: notification system should read this flag and send a
			// notification to createdById / createdByType when true.
			rejectionPendingNotification: extra.rejectionPendingNotification,
			rejectionNotificationTarget: extra.rejectionPendingNotification
				? { type: extra.creatorType, id: extra.creatorId }
				: null,
		}),
	};
}
