import { TRPCError } from "@trpc/server";
import type { ParticipantType, Prisma, PrismaClient } from "~prisma";
import { getImageUrl } from "~/server/storage";
import { computeBalance, computeBalanceBatch } from "./balance";
import type { ParticipantRef } from "./types";

type AppDb = PrismaClient;

export interface PersonIdentity {
	name: string;
	username: string | null;
	email: string | null;
	phone: string | null;
	avatarUrl: string | null;
	participantType: ParticipantType;
	participantId: string;
	/** True for verified Retrospend users, false for guests and shadow profiles. */
	isVerifiedUser: boolean;
}

export interface BalanceCurrency {
	/** Absolute value of the balance in this currency. */
	balance: number;
	currency: string;
	direction: "they_owe_you" | "you_owe_them" | "settled";
}

export interface PersonListItem {
	identity: PersonIdentity;
	/** Per-currency balances. Empty array means fully settled. */
	balances: BalanceCurrency[];
	/** Count of transactions where the current user's verification is PENDING
	 *  and this person is a co-participant. */
	pendingVerificationCount: number;
	/** Count of transactions with this person where the current user has unseen changes. */
	unseenChangesCount: number;
	mostRecentTransactionDate: Date | null;
	mostRecentTransactionDescription: string | null;
	mostRecentTransactionProject: string | null;
	expenseCount: number;
	projectCount: number;
}

export interface TransactionHistoryItem {
	id: string;
	description: string;
	amount: number;
	currency: string;
	category: { id: string; name: string; color: string; icon: string | null } | null;
	date: Date;
	paidBy: ParticipantRef & { name: string; avatarUrl: string | null; isMe: boolean };
	myShare: number;
	theirShare: number;
	myVerificationStatus: string;
	theirVerificationStatus: string;
	/** Null until Project model is added in Phase 2. */
	project: { id: string; name: string } | null;
	status: "pending" | "active" | "settled";
	canEdit: boolean;
	canDelete: boolean;
	hasUnseenChanges: boolean;
}

export interface RelationshipStats {
	firstTransactionDate: Date | null;
	transactionCount: number;
	projectCount: number;
	settlementCount: number;
}

export interface ProjectBreakdownItem {
	projectId: string | null;
	projectName: string | null;
	transactionCount: number;
	balances: BalanceCurrency[];
}

export interface PersonDetail {
	identity: PersonIdentity;
	balances: BalanceCurrency[];
	transactions: TransactionHistoryItem[];
	total: number;
	page: number;
	limit: number;
	relationshipStats: RelationshipStats;
	projectBreakdown: ProjectBreakdownItem[];
}

export interface PersonDetailCursorResult {
	identity?: PersonIdentity;
	balances?: BalanceCurrency[];
	transactions: TransactionHistoryItem[];
	nextCursor: string | undefined;
	relationshipStats?: RelationshipStats;
	projectBreakdown?: ProjectBreakdownItem[];
}

type TransactionStatus = "active" | "pending" | "settled";

interface PersonDetailOptions {
	status?: TransactionStatus;
	projectId?: string;
	page?: number;
	limit?: number;
}

function toDirection(
	balance: number,
): "they_owe_you" | "you_owe_them" | "settled" {
	if (balance > 0) return "they_owe_you";
	if (balance < 0) return "you_owe_them";
	return "settled";
}

export class PeopleService {
	private currentUserRef: ParticipantRef;

	constructor(
		private db: AppDb,
		private actor: ParticipantRef,
	) {
		this.currentUserRef = actor;
	}

	/**
	 * Returns all people the current user has a shared financial relationship with,
	 * with computed net balances and pending verification counts.
	 *
	 * Sort order: nonzero balances first (by max absolute balance desc), then
	 * settled contacts by most recent transaction date desc.
	 *
	 * TODO: For users with many contacts, add a caching layer or materialized
	 * balance table. The current approach runs 4 DB queries per contact
	 * (concurrently), which is fine for v1.
	 *
	 * NOTE: When a shadow profile has been claimed by a verified user (claimedById
	 * is set), the balance is only computed for the shadow profile ref. Transactions
	 * created after the merge that use the user ref are NOT yet included. A future
	 * improvement should detect claimed shadows and sum both refs' balances.
	 */
	async listPeople(): Promise<PersonListItem[]> {
		// Single query: all transactions the user is part of, with participant data.
		// RLS on shared_transaction ensures only the user's transactions are returned.
		const transactions = await this.db.sharedTransaction.findMany({
			where: {
				splitParticipants: {
					some: {
						participantType: this.currentUserRef.participantType,
						participantId: this.currentUserRef.participantId,
					},
				},
			},
			select: {
				date: true,
				description: true,
				project: { select: { id: true, name: true } },
				splitParticipants: {
					select: {
						participantType: true,
						participantId: true,
						verificationStatus: true,
						hasUnseenChanges: true,
					},
				},
			},
		});

		if (transactions.length === 0) return [];

		// Single pass: collect per-contact stats.
		const contactStats = new Map<
			string,
			{
				participantType: ParticipantType;
				participantId: string;
				mostRecentDate: Date;
				mostRecentDescription: string | null;
				mostRecentProjectName: string | null;
				pendingVerificationCount: number;
				unseenChangesCount: number;
				transactionCount: number;
				projectIds: Set<string>;
			}
		>();

		for (const tx of transactions) {
			const myEntry = tx.splitParticipants.find(
				(sp) =>
					sp.participantType === this.currentUserRef.participantType &&
					sp.participantId === this.currentUserRef.participantId,
			);
			if (!myEntry) continue;

			const myVerificationIsPending = myEntry.verificationStatus === "PENDING";
			const myHasUnseen = myEntry.hasUnseenChanges;

			for (const sp of tx.splitParticipants) {
				if (
					sp.participantType === this.currentUserRef.participantType &&
					sp.participantId === this.currentUserRef.participantId
				) {
					continue;
				}

				const key = `${sp.participantType}:${sp.participantId}`;
				const existing = contactStats.get(key);
				if (!existing) {
					const projectIds = new Set<string>();
					if (tx.project?.id) projectIds.add(tx.project.id);
					contactStats.set(key, {
						participantType: sp.participantType as ParticipantType,
						participantId: sp.participantId,
						mostRecentDate: tx.date,
						mostRecentDescription: tx.description,
						mostRecentProjectName: tx.project?.name ?? null,
						pendingVerificationCount: myVerificationIsPending ? 1 : 0,
						unseenChangesCount: myHasUnseen ? 1 : 0,
						transactionCount: 1,
						projectIds,
					});
				} else {
					existing.transactionCount += 1;
					if (tx.project?.id) existing.projectIds.add(tx.project.id);
					if (tx.date > existing.mostRecentDate) {
						existing.mostRecentDate = tx.date;
						existing.mostRecentDescription = tx.description;
						existing.mostRecentProjectName = tx.project?.name ?? null;
					}
					if (myVerificationIsPending) {
						existing.pendingVerificationCount += 1;
					}
					if (myHasUnseen) {
						existing.unseenChangesCount += 1;
					}
				}
			}
		}

				const allContacts = Array.from(contactStats.values());

		// Filter out shadow profiles not owned by the current user.
		// (The RLS policy on shadow_profile already enforces createdById=userId at
		// the DB layer, so the findMany below naturally returns only owned shadows.)
		const contacts = await this.filterAuthorizedContacts(allContacts);

		// Batch compute all balances in 4 queries total (instead of 4 per contact).
		const [balanceResults, identities] = await Promise.all([
			computeBalanceBatch(
				this.db,
				this.currentUserRef,
				contacts.map((c) => ({
					participantType: c.participantType,
					participantId: c.participantId,
				})),
			),
			this.resolveIdentitiesBatch(contacts),
		]);

		const items: PersonListItem[] = contacts.map((contact, i) => {
			const byCurrency = balanceResults[i]!.byCurrency;
			const balances: BalanceCurrency[] = Object.entries(byCurrency).map(
				([currency, balance]) => ({
					balance: Math.abs(balance),
					currency,
					direction: toDirection(balance),
				}),
			);

			const stats = contactStats.get(
				`${contact.participantType}:${contact.participantId}`,
			)!;

			return {
				identity: identities[i]!,
				balances,
				pendingVerificationCount: stats.pendingVerificationCount,
				unseenChangesCount: stats.unseenChangesCount,
				mostRecentTransactionDate: stats.mostRecentDate,
				mostRecentTransactionDescription: stats.mostRecentDescription,
				mostRecentTransactionProject: stats.mostRecentProjectName,
				expenseCount: stats.transactionCount,
				projectCount: stats.projectIds.size,
			};
		});

		return items.sort((a, b) => {
			const aHasBalance = a.balances.length > 0;
			const bHasBalance = b.balances.length > 0;

			if (aHasBalance && !bHasBalance) return -1;
			if (!aHasBalance && bHasBalance) return 1;

			if (aHasBalance && bHasBalance) {
				const aMax = Math.max(...a.balances.map((bl) => bl.balance));
				const bMax = Math.max(...b.balances.map((bl) => bl.balance));
				return bMax - aMax;
			}

			// Both settled: sort by most recent transaction date.
			const aDate = a.mostRecentTransactionDate?.getTime() ?? 0;
			const bDate = b.mostRecentTransactionDate?.getTime() ?? 0;
			return bDate - aDate;
		});
	}

	/**
	 * Returns full detail for a specific person: identity, net balance, and
	 * paginated transaction history shared with the current user.
	 */
	async getPersonDetail(
		ref: ParticipantRef,
		options: PersonDetailOptions = {},
	): Promise<PersonDetail> {
		const { page = 1, limit = 20, status, projectId } = options;

		await this.assertContactAccessible(ref);

		// Base where clause: all transactions between the two people
		const baseAndClauses: Prisma.SharedTransactionWhereInput[] = [
			{
				splitParticipants: {
					some: {
						participantType: this.currentUserRef.participantType,
						participantId: this.currentUserRef.participantId,
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
		];

		// Filtered where clause: applies status/projectId filters for the paginated list
		const andClauses = [...baseAndClauses];

		if (projectId) {
			andClauses.push({ projectId });
		}

		if (status === "settled") {
			andClauses.push({ isLocked: true });
		} else if (status === "pending") {
			andClauses.push({ isLocked: false });
			andClauses.push({
				splitParticipants: { some: { verificationStatus: "PENDING" } },
			});
		} else if (status === "active") {
			andClauses.push({ isLocked: false });
			andClauses.push({
				splitParticipants: { none: { verificationStatus: "PENDING" } },
			});
		}

		const where: Prisma.SharedTransactionWhereInput = { AND: andClauses };
		const baseWhere: Prisma.SharedTransactionWhereInput = {
			AND: baseAndClauses,
		};

		const [
			total,
			rawTransactions,
			balanceResult,
			identity,
			allTxnsSummary,
			settlementCount,
		] = await Promise.all([
			this.db.sharedTransaction.count({ where }),
			this.db.sharedTransaction.findMany({
				where,
				select: {
					id: true,
					description: true,
					amount: true,
					currency: true,
					date: true,
					isLocked: true,
					paidByType: true,
					paidById: true,
					createdByType: true,
					createdById: true,
					projectId: true,
					project: { select: { id: true, name: true } },
					// Category may be null if it belongs to a different user (RLS-filtered).
					category: { select: { id: true, name: true, color: true, icon: true } },
					splitParticipants: {
						select: {
							participantType: true,
							participantId: true,
							shareAmount: true,
							verificationStatus: true,
							hasUnseenChanges: true,
						},
					},
				},
				orderBy: { date: "desc" },
				skip: (page - 1) * limit,
				take: limit,
			}),
			computeBalance(this.db, this.currentUserRef, ref),
			this.resolveIdentity(ref),
			// Lightweight query for stats + project breakdown (all transactions, no pagination)
			this.db.sharedTransaction.findMany({
				where: baseWhere,
				select: {
					date: true,
					projectId: true,
					project: { select: { id: true, name: true } },
					currency: true,
					paidByType: true,
					paidById: true,
					splitParticipants: {
						where: {
							OR: [
								{
									participantType:
										this.currentUserRef.participantType,
									participantId:
										this.currentUserRef.participantId,
								},
								{
									participantType: ref.participantType,
									participantId: ref.participantId,
								},
							],
						},
						select: {
							participantType: true,
							participantId: true,
							shareAmount: true,
						},
					},
				},
			}),
			// Settlement count between the two people
			this.db.settlement.count({
				where: {
					OR: [
						{
							fromParticipantType:
								this.currentUserRef.participantType,
							fromParticipantId:
								this.currentUserRef.participantId,
							toParticipantType: ref.participantType,
							toParticipantId: ref.participantId,
						},
						{
							fromParticipantType: ref.participantType,
							fromParticipantId: ref.participantId,
							toParticipantType:
								this.currentUserRef.participantType,
							toParticipantId:
								this.currentUserRef.participantId,
						},
					],
				},
			}),
		]);

		// Resolve paidBy names and avatars with deduplication.
		const paidByRefs: ParticipantRef[] = rawTransactions.map((tx) => ({
			participantType: tx.paidByType as ParticipantType,
			participantId: tx.paidById,
		}));
		const paidByData = await this.resolveNamesBatch(paidByRefs);

		// Batch-fetch the caller's project roles for permission computation.
		const projectIds = [
			...new Set(
				rawTransactions
					.map((tx) => tx.projectId)
					.filter((id): id is string => id !== null),
			),
		];
		const callerRoleMap = new Map<string, string>();
		if (projectIds.length > 0) {
			const roles = await this.db.projectParticipant.findMany({
				where: {
					projectId: { in: projectIds },
					participantType: this.currentUserRef.participantType,
					participantId: this.currentUserRef.participantId,
				},
				select: { projectId: true, role: true },
			});
			for (const r of roles) {
				callerRoleMap.set(r.projectId, r.role);
			}
		}

		const transactions: TransactionHistoryItem[] = rawTransactions.map(
			(tx, i) => {
				const myPart = tx.splitParticipants.find(
					(sp) =>
						sp.participantType === this.currentUserRef.participantType &&
						sp.participantId === this.currentUserRef.participantId,
				);
				const theirPart = tx.splitParticipants.find(
					(sp) =>
						sp.participantType === ref.participantType &&
						sp.participantId === ref.participantId,
				);

				let txStatus: "pending" | "active" | "settled";
				if (tx.isLocked) {
					txStatus = "settled";
				} else if (
					tx.splitParticipants.some((sp) => sp.verificationStatus === "PENDING")
				) {
					txStatus = "pending";
				} else {
					txStatus = "active";
				}

				const isCreator =
					tx.createdByType === this.currentUserRef.participantType &&
					tx.createdById === this.currentUserRef.participantId;
				let canEdit = false;
				let canDelete = false;
				if (!tx.isLocked) {
					if (tx.projectId) {
						const role = callerRoleMap.get(tx.projectId);
						if (
							role === "ORGANIZER" ||
							role === "EDITOR" ||
							(role === "CONTRIBUTOR" && isCreator)
						) {
							canEdit = true;
							canDelete = true;
						}
					} else {
						canEdit = isCreator;
						canDelete = isCreator;
					}
				}

				return {
					id: tx.id,
					description: tx.description,
					amount: Number(tx.amount),
					currency: tx.currency,
					category: tx.category,
					date: tx.date,
					paidBy: {
						participantType: tx.paidByType as ParticipantType,
						participantId: tx.paidById,
						name: paidByData[i]?.name ?? "Unknown",
						avatarUrl: paidByData[i]?.avatarUrl ?? null,
						isMe: tx.paidByType === this.currentUserRef.participantType && tx.paidById === this.currentUserRef.participantId,
					},
					myShare: myPart ? Number(myPart.shareAmount) : 0,
					theirShare: theirPart ? Number(theirPart.shareAmount) : 0,
					myVerificationStatus: myPart?.verificationStatus ?? "PENDING",
					theirVerificationStatus: theirPart?.verificationStatus ?? "PENDING",
					project: tx.project ?? null,
					status: txStatus,
					canEdit,
					canDelete,
					hasUnseenChanges: myPart?.hasUnseenChanges ?? false,
				};
			},
		);

		const balances: BalanceCurrency[] = Object.entries(
			balanceResult.byCurrency,
		).map(([currency, balance]) => ({
			balance: Math.abs(balance),
			currency,
			direction: toDirection(balance),
		}));

		// Compute relationship stats and per-project breakdown from allTxnsSummary
		let firstTransactionDate: Date | null = null;
		const projectStatsMap = new Map<
			string | null,
			{
				projectName: string | null;
				transactionCount: number;
				byCurrency: Record<string, number>;
			}
		>();
		const distinctProjectIds = new Set<string>();

		for (const tx of allTxnsSummary) {
			// Track earliest date
			if (!firstTransactionDate || tx.date < firstTransactionDate) {
				firstTransactionDate = tx.date;
			}
			// Track distinct projects
			if (tx.projectId) {
				distinctProjectIds.add(tx.projectId);
			}
			// Per-project stats
			const key = tx.projectId;
			let entry = projectStatsMap.get(key);
			if (!entry) {
				entry = {
					projectName: tx.project?.name ?? null,
					transactionCount: 0,
					byCurrency: {},
				};
				projectStatsMap.set(key, entry);
			}
			entry.transactionCount++;

			const theirPart = tx.splitParticipants.find(
				(sp) =>
					sp.participantType === ref.participantType &&
					sp.participantId === ref.participantId,
			);
			const myPart = tx.splitParticipants.find(
				(sp) =>
					sp.participantType ===
						this.currentUserRef.participantType &&
					sp.participantId === this.currentUserRef.participantId,
			);

			const isPaidByMe =
				tx.paidByType === this.currentUserRef.participantType &&
				tx.paidById === this.currentUserRef.participantId;
			const isPaidByThem =
				tx.paidByType === ref.participantType &&
				tx.paidById === ref.participantId;

			if (isPaidByMe && theirPart) {
				entry.byCurrency[tx.currency] =
					(entry.byCurrency[tx.currency] ?? 0) +
					Number(theirPart.shareAmount);
			}
			if (isPaidByThem && myPart) {
				entry.byCurrency[tx.currency] =
					(entry.byCurrency[tx.currency] ?? 0) -
					Number(myPart.shareAmount);
			}
		}

		const relationshipStats: RelationshipStats = {
			firstTransactionDate,
			transactionCount: allTxnsSummary.length,
			projectCount: distinctProjectIds.size,
			settlementCount,
		};

		const projectBreakdown: ProjectBreakdownItem[] = Array.from(
			projectStatsMap.entries(),
		)
			.map(([projectId, data]) => ({
				projectId,
				projectName: data.projectName,
				transactionCount: data.transactionCount,
				balances: Object.entries(data.byCurrency)
					.filter(
						([, balance]) => Math.abs(balance) >= 0.00000001,
					)
					.map(([currency, balance]) => ({
						balance: Math.abs(balance),
						currency,
						direction: toDirection(balance),
					})),
			}))
			// Sort: projects with balances first, then by transaction count
			.sort((a, b) => {
				const aHasBalance = a.balances.length > 0;
				const bHasBalance = b.balances.length > 0;
				if (aHasBalance && !bHasBalance) return -1;
				if (!aHasBalance && bHasBalance) return 1;
				return b.transactionCount - a.transactionCount;
			});

		return {
			identity,
			balances,
			transactions,
			total,
			page,
			limit,
			relationshipStats,
			projectBreakdown,
		};
	}

	/**
	 * Cursor-based variant of getPersonDetail for infinite scrolling.
	 * The first call (no cursor) returns identity, balances, stats, breakdown.
	 * Subsequent calls (with cursor) return only transactions + nextCursor.
	 */
	async getPersonDetailCursor(
		ref: ParticipantRef,
		options: { limit?: number; cursor?: string; projectId?: string } = {},
	): Promise<PersonDetailCursorResult> {
		const { limit = 30, cursor, projectId } = options;
		const isFirstPage = !cursor;

		await this.assertContactAccessible(ref);

		// Base where clause: all transactions between the two people
		const baseAndClauses: Prisma.SharedTransactionWhereInput[] = [
			{
				splitParticipants: {
					some: {
						participantType: this.currentUserRef.participantType,
						participantId: this.currentUserRef.participantId,
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
		];

		const andClauses = [...baseAndClauses];
		if (projectId) {
			andClauses.push({ projectId });
		}
		if (cursor) {
			andClauses.push({ date: { lt: new Date(cursor) } });
		}

		const where: Prisma.SharedTransactionWhereInput = { AND: andClauses };
		const baseWhere: Prisma.SharedTransactionWhereInput = {
			AND: baseAndClauses,
		};

		// Build parallel queries
		const rawTransactionsPromise = this.db.sharedTransaction.findMany({
			where,
			select: {
				id: true,
				description: true,
				amount: true,
				currency: true,
				date: true,
				isLocked: true,
				paidByType: true,
				paidById: true,
				createdByType: true,
				createdById: true,
				projectId: true,
				project: { select: { id: true, name: true } },
				category: { select: { id: true, name: true, color: true, icon: true } },
				splitParticipants: {
					select: {
						participantType: true,
						participantId: true,
						shareAmount: true,
						verificationStatus: true,
						hasUnseenChanges: true,
					},
				},
			},
			orderBy: { date: "desc" },
			take: limit + 1,
		});

		if (isFirstPage) {
			const [
				rawTransactions,
				balanceResult,
				identity,
				allTxnsSummary,
				settlementCount,
			] = await Promise.all([
				rawTransactionsPromise,
				computeBalance(this.db, this.currentUserRef, ref),
				this.resolveIdentity(ref),
				this.db.sharedTransaction.findMany({
					where: baseWhere,
					select: {
						date: true,
						projectId: true,
						project: { select: { id: true, name: true } },
						currency: true,
						paidByType: true,
						paidById: true,
						splitParticipants: {
							where: {
								OR: [
									{
										participantType:
											this.currentUserRef.participantType,
										participantId:
											this.currentUserRef.participantId,
									},
									{
										participantType: ref.participantType,
										participantId: ref.participantId,
									},
								],
							},
							select: {
								participantType: true,
								participantId: true,
								shareAmount: true,
							},
						},
					},
				}),
				this.db.settlement.count({
					where: {
						OR: [
							{
								fromParticipantType:
									this.currentUserRef.participantType,
								fromParticipantId:
									this.currentUserRef.participantId,
								toParticipantType: ref.participantType,
								toParticipantId: ref.participantId,
							},
							{
								fromParticipantType: ref.participantType,
								fromParticipantId: ref.participantId,
								toParticipantType:
									this.currentUserRef.participantType,
								toParticipantId:
									this.currentUserRef.participantId,
							},
						],
					},
				}),
			]);

			let nextCursor: string | undefined;
			const slicedTransactions =
				rawTransactions.length > limit
					? rawTransactions.slice(0, limit)
					: rawTransactions;
			if (rawTransactions.length > limit) {
				const lastItem = slicedTransactions[slicedTransactions.length - 1]!;
				nextCursor = lastItem.date.toISOString();
			}

			const transactions = await this.mapTransactions(
				slicedTransactions,
				ref,
			);

			const balances: BalanceCurrency[] = Object.entries(
				balanceResult.byCurrency,
			).map(([currency, balance]) => ({
				balance: Math.abs(balance),
				currency,
				direction: toDirection(balance),
			}));

			const { relationshipStats, projectBreakdown } =
				this.computeStatsAndBreakdown(
					allTxnsSummary,
					ref,
					settlementCount,
				);

			return {
				identity,
				balances,
				transactions,
				nextCursor,
				relationshipStats,
				projectBreakdown,
			};
		}

		// Subsequent pages: only transactions + cursor
		const rawTransactions = await rawTransactionsPromise;

		let nextCursor: string | undefined;
		const slicedTransactions =
			rawTransactions.length > limit
				? rawTransactions.slice(0, limit)
				: rawTransactions;
		if (rawTransactions.length > limit) {
			const lastItem = slicedTransactions[slicedTransactions.length - 1]!;
			nextCursor = lastItem.date.toISOString();
		}

		const transactions = await this.mapTransactions(slicedTransactions, ref);

		return {
			transactions,
			nextCursor,
		};
	}

	/**
	 * Returns per-currency balances between the current user and the given person.
	 * Multiple currencies are returned as separate entries: no cross-currency netting.
	 */
	async getBalance(ref: ParticipantRef): Promise<BalanceCurrency[]> {
		await this.assertContactAccessible(ref);
		const result = await computeBalance(this.db, this.currentUserRef, ref);
		return Object.entries(result.byCurrency).map(([currency, balance]) => ({
			balance: Math.abs(balance),
			currency,
			direction: toDirection(balance),
		}));
	}

	/**
	 * Maps raw shared transaction records into TransactionHistoryItem[].
	 * Resolves paidBy names/avatars and computes edit/delete permissions.
	 */
	private async mapTransactions(
		rawTransactions: Array<{
			id: string;
			description: string;
			amount: unknown;
			currency: string;
			date: Date;
			isLocked: boolean;
			paidByType: string;
			paidById: string;
			createdByType: string;
			createdById: string;
			projectId: string | null;
			project: { id: string; name: string } | null;
			category: { id: string; name: string; color: string; icon: string | null } | null;
			splitParticipants: Array<{
				participantType: string;
				participantId: string;
				shareAmount: unknown;
				verificationStatus: string;
				hasUnseenChanges: boolean;
			}>;
		}>,
		ref: ParticipantRef,
	): Promise<TransactionHistoryItem[]> {
		const paidByRefs: ParticipantRef[] = rawTransactions.map((tx) => ({
			participantType: tx.paidByType as ParticipantType,
			participantId: tx.paidById,
		}));
		const paidByData = await this.resolveNamesBatch(paidByRefs);

		const projectIds = [
			...new Set(
				rawTransactions
					.map((tx) => tx.projectId)
					.filter((id): id is string => id !== null),
			),
		];
		const callerRoleMap = new Map<string, string>();
		if (projectIds.length > 0) {
			const roles = await this.db.projectParticipant.findMany({
				where: {
					projectId: { in: projectIds },
					participantType: this.currentUserRef.participantType,
					participantId: this.currentUserRef.participantId,
				},
				select: { projectId: true, role: true },
			});
			for (const r of roles) {
				callerRoleMap.set(r.projectId, r.role);
			}
		}

		return rawTransactions.map((tx, i) => {
			const myPart = tx.splitParticipants.find(
				(sp) =>
					sp.participantType === this.currentUserRef.participantType &&
					sp.participantId === this.currentUserRef.participantId,
			);
			const theirPart = tx.splitParticipants.find(
				(sp) =>
					sp.participantType === ref.participantType &&
					sp.participantId === ref.participantId,
			);

			let txStatus: "pending" | "active" | "settled";
			if (tx.isLocked) {
				txStatus = "settled";
			} else if (
				tx.splitParticipants.some(
					(sp) => sp.verificationStatus === "PENDING",
				)
			) {
				txStatus = "pending";
			} else {
				txStatus = "active";
			}

			const isCreator =
				tx.createdByType === this.currentUserRef.participantType &&
				tx.createdById === this.currentUserRef.participantId;
			let canEdit = false;
			let canDelete = false;
			if (!tx.isLocked) {
				if (tx.projectId) {
					const role = callerRoleMap.get(tx.projectId);
					if (
						role === "ORGANIZER" ||
						role === "EDITOR" ||
						(role === "CONTRIBUTOR" && isCreator)
					) {
						canEdit = true;
						canDelete = true;
					}
				} else {
					canEdit = isCreator;
					canDelete = isCreator;
				}
			}

			return {
				id: tx.id,
				description: tx.description,
				amount: Number(tx.amount),
				currency: tx.currency,
				category: tx.category,
				date: tx.date,
				paidBy: {
					participantType: tx.paidByType as ParticipantType,
					participantId: tx.paidById,
					name: paidByData[i]?.name ?? "Unknown",
					avatarUrl: paidByData[i]?.avatarUrl ?? null,
					isMe: tx.paidByType === this.currentUserRef.participantType && tx.paidById === this.currentUserRef.participantId,
				},
				myShare: myPart ? Number(myPart.shareAmount) : 0,
				theirShare: theirPart ? Number(theirPart.shareAmount) : 0,
				myVerificationStatus: myPart?.verificationStatus ?? "PENDING",
				theirVerificationStatus:
					theirPart?.verificationStatus ?? "PENDING",
				project: tx.project ?? null,
				status: txStatus,
				canEdit,
				canDelete,
				hasUnseenChanges: myPart?.hasUnseenChanges ?? false,
			};
		});
	}

	/**
	 * Computes relationship stats and per-project balance breakdown from a
	 * summary of all transactions between two people.
	 */
	private computeStatsAndBreakdown(
		allTxnsSummary: Array<{
			date: Date;
			projectId: string | null;
			project: { id: string; name: string } | null;
			currency: string;
			paidByType: string;
			paidById: string;
			splitParticipants: Array<{
				participantType: string;
				participantId: string;
				shareAmount: unknown;
			}>;
		}>,
		ref: ParticipantRef,
		settlementCount: number,
	): { relationshipStats: RelationshipStats; projectBreakdown: ProjectBreakdownItem[] } {
		let firstTransactionDate: Date | null = null;
		const projectStatsMap = new Map<
			string | null,
			{
				projectName: string | null;
				transactionCount: number;
				byCurrency: Record<string, number>;
			}
		>();
		const distinctProjectIds = new Set<string>();

		for (const tx of allTxnsSummary) {
			if (!firstTransactionDate || tx.date < firstTransactionDate) {
				firstTransactionDate = tx.date;
			}
			if (tx.projectId) {
				distinctProjectIds.add(tx.projectId);
			}
			const key = tx.projectId;
			let entry = projectStatsMap.get(key);
			if (!entry) {
				entry = {
					projectName: tx.project?.name ?? null,
					transactionCount: 0,
					byCurrency: {},
				};
				projectStatsMap.set(key, entry);
			}
			entry.transactionCount++;

			const theirPart = tx.splitParticipants.find(
				(sp) =>
					sp.participantType === ref.participantType &&
					sp.participantId === ref.participantId,
			);
			const myPart = tx.splitParticipants.find(
				(sp) =>
					sp.participantType ===
						this.currentUserRef.participantType &&
					sp.participantId === this.currentUserRef.participantId,
			);

			const isPaidByMe =
				tx.paidByType === this.currentUserRef.participantType &&
				tx.paidById === this.currentUserRef.participantId;
			const isPaidByThem =
				tx.paidByType === ref.participantType &&
				tx.paidById === ref.participantId;

			if (isPaidByMe && theirPart) {
				entry.byCurrency[tx.currency] =
					(entry.byCurrency[tx.currency] ?? 0) +
					Number(theirPart.shareAmount);
			}
			if (isPaidByThem && myPart) {
				entry.byCurrency[tx.currency] =
					(entry.byCurrency[tx.currency] ?? 0) -
					Number(myPart.shareAmount);
			}
		}

		const relationshipStats: RelationshipStats = {
			firstTransactionDate,
			transactionCount: allTxnsSummary.length,
			projectCount: distinctProjectIds.size,
			settlementCount,
		};

		const projectBreakdown: ProjectBreakdownItem[] = Array.from(
			projectStatsMap.entries(),
		)
			.map(([projectId, data]) => ({
				projectId,
				projectName: data.projectName,
				transactionCount: data.transactionCount,
				balances: Object.entries(data.byCurrency)
					.filter(
						([, balance]) => Math.abs(balance) >= 0.00000001,
					)
					.map(([currency, balance]) => ({
						balance: Math.abs(balance),
						currency,
						direction: toDirection(balance),
					})),
			}))
			.sort((a, b) => {
				const aHasBalance = a.balances.length > 0;
				const bHasBalance = b.balances.length > 0;
				if (aHasBalance && !bHasBalance) return -1;
				if (!aHasBalance && bHasBalance) return 1;
				return b.transactionCount - a.transactionCount;
			});

		return { relationshipStats, projectBreakdown };
	}

	/**
	 * Asserts the current user has a shared financial relationship with the given
	 * participant, and that the participant is visible to the user.
	 * Throws NOT_FOUND if not accessible.
	 */
	private async assertContactAccessible(ref: ParticipantRef): Promise<void> {
		if (ref.participantType === "shadow") {
			// RLS on shadow_profile filters by createdById=userId, so findUnique
			// returns null if this shadow belongs to a different user.
			const profile = await this.db.shadowProfile.findUnique({
				where: { id: ref.participantId },
				select: { id: true },
			});
			if (!profile) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Person not found",
				});
			}
		}

		const hasRelationship = await this.db.sharedTransaction.count({
			where: {
				AND: [
					{
						splitParticipants: {
							some: {
								participantType: this.currentUserRef.participantType,
								participantId: this.currentUserRef.participantId,
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

		if (!hasRelationship) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "No shared transactions found with this person",
			});
		}
	}

	/**
	 * Filters a contact list to exclude shadow profiles not owned by the current user.
	 * Relies on the shadow_profile RLS policy (createdById = current_user_id) to
	 * naturally exclude unauthorized shadows via the DB query.
	 */
	private async filterAuthorizedContacts<
		T extends { participantType: ParticipantType; participantId: string },
	>(contacts: T[]): Promise<T[]> {
		const shadowContacts = contacts.filter(
			(c) => c.participantType === "shadow",
		);
		if (shadowContacts.length === 0) return contacts;

		const authorizedShadows = await this.db.shadowProfile.findMany({
			where: { id: { in: shadowContacts.map((c) => c.participantId) } },
			select: { id: true },
		});

		const authorizedShadowIds = new Set(authorizedShadows.map((s) => s.id));

		return contacts.filter(
			(c) =>
				c.participantType !== "shadow" ||
				authorizedShadowIds.has(c.participantId),
		);
	}

	/**
	 * Resolves display identities for a batch of participant refs.
	 * Deduplicates DB lookups per participant type.
	 */
	private async resolveIdentitiesBatch(
		contacts: Array<{
			participantType: ParticipantType;
			participantId: string;
		}>,
	): Promise<PersonIdentity[]> {
		if (contacts.length === 0) return [];

		const userIds = [
			...new Set(
				contacts
					.filter((c) => c.participantType === "user")
					.map((c) => c.participantId),
			),
		];
		const shadowIds = [
			...new Set(
				contacts
					.filter((c) => c.participantType === "shadow")
					.map((c) => c.participantId),
			),
		];
		const guestIds = [
			...new Set(
				contacts
					.filter((c) => c.participantType === "guest")
					.map((c) => c.participantId),
			),
		];

		const [users, shadows, guests] = await Promise.all([
			userIds.length > 0
				? this.db.user.findMany({
						where: { id: { in: userIds } },
						select: { id: true, name: true, username: true, image: true, avatarPath: true },
					})
				: [],
			shadowIds.length > 0
				? this.db.shadowProfile.findMany({
						where: { id: { in: shadowIds } },
						select: { id: true, name: true, email: true, phone: true },
					})
				: [],
			guestIds.length > 0
				? this.db.guestSession.findMany({
						where: { id: { in: guestIds } },
						select: { id: true, name: true, email: true },
					})
				: [],
		]);

		const userMap = new Map(users.map((u) => [u.id, u]));
		const shadowMap = new Map(shadows.map((s) => [s.id, s]));
		const guestMap = new Map(guests.map((g) => [g.id, g]));

		return contacts.map((c) => {
			if (c.participantType === "user") {
				if (c.participantId === "DELETED_USER") {
					return {
						name: "Deleted User",
						username: null,
						email: null,
						phone: null,
						avatarUrl: null,
						participantType: c.participantType,
						participantId: c.participantId,
						isVerifiedUser: false,
					};
				}
				const u = userMap.get(c.participantId);
				return {
					name: u?.name ?? "Unknown User",
					username: u?.username ?? null,
					email: null,
					phone: null,
					avatarUrl: getImageUrl(u?.avatarPath ?? null) ?? u?.image ?? null,
					participantType: c.participantType,
					participantId: c.participantId,
					isVerifiedUser: true,
				};
			}
			if (c.participantType === "shadow") {
				const s = shadowMap.get(c.participantId);
				return {
					name: s?.name ?? "Unknown",
					username: null,
					email: s?.email ?? null,
					phone: s?.phone ?? null,
					avatarUrl: null,
					participantType: c.participantType,
					participantId: c.participantId,
					isVerifiedUser: false,
				};
			}
			// guest
			if (c.participantId === "DELETED_GUEST") {
				return {
					name: "Deleted Guest",
					username: null,
					email: null,
					phone: null,
					avatarUrl: null,
					participantType: c.participantType,
					participantId: c.participantId,
					isVerifiedUser: false,
				};
			}
			const g = guestMap.get(c.participantId);
			return {
				name: g?.name ?? "Unknown Guest",
				username: null,
				email: g?.email ?? null,
				phone: null,
				avatarUrl: null,
				participantType: c.participantType,
				participantId: c.participantId,
				isVerifiedUser: false,
			};
		});
	}

	private async resolveIdentity(ref: ParticipantRef): Promise<PersonIdentity> {
		const [identity] = await this.resolveIdentitiesBatch([ref]);
		return identity!;
	}

	/**
	 * Resolves names for a list of participant refs (may contain duplicates).
	 * Deduplicates DB lookups before fetching.
	 */
	private async resolveNamesBatch(
		refs: ParticipantRef[],
	): Promise<Array<{ name: string; avatarUrl: string | null }>> {
		if (refs.length === 0) return [];

		const uniqueRefs = Array.from(
			new Map(
				refs.map((r) => [`${r.participantType}:${r.participantId}`, r]),
			).values(),
		);

		const identities = await this.resolveIdentitiesBatch(uniqueRefs);
		const identityMap = new Map(
			uniqueRefs.map((ref, i) => [
				`${ref.participantType}:${ref.participantId}`,
				identities[i]!,
			]),
		);

		return refs.map((r) => {
			const identity = identityMap.get(
				`${r.participantType}:${r.participantId}`,
			);
			return {
				name: identity?.name ?? "Unknown",
				avatarUrl: identity?.avatarUrl ?? null,
			};
		});
	}
}
