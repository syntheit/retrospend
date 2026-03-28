/**
 * Shared Expense Integration
 *
 * Provides helper functions for integrating shared expense data into
 * personal finance views (transactions, budgets, stats, wealth).
 *
 * IMPORTANT: These functions return the CURRENT USER'S SHARE only,
 * never the full transaction amount.
 */
import type { Prisma, PrismaClient } from "~prisma";
import { toUSD } from "../currency";
import { getBestExchangeRate } from "../api/routers/shared-currency";
import type { RateCache } from "./rate-cache";

type AppDb = PrismaClient | Prisma.TransactionClient;

/**
 * Fetches project IDs that the user has marked as excluded from analytics.
 */
export async function getExcludedProjectIds(
	db: AppDb,
	userId: string,
): Promise<string[]> {
	const excluded = await (db as PrismaClient).projectParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			excludeFromAnalytics: true,
		},
		select: { projectId: true },
	});
	return excluded.map((e) => e.projectId);
}

/** Builds a Prisma WHERE filter that excludes transactions from specific projects. */
function excludedProjectFilter(
	excludedProjectIds?: string[],
): Prisma.SharedTransactionWhereInput | undefined {
	if (!excludedProjectIds || excludedProjectIds.length === 0) return undefined;
	return {
		OR: [
			{ projectId: null },
			{ projectId: { notIn: excludedProjectIds } },
		],
	};
}

/**
 * Represents a user's share of a shared expense, compatible with
 * the budget/stats aggregation format (same fields as personal expenses).
 */
export interface SharedExpenseShare {
	amount: number;
	currency: string;
	amountInUSD: number;
	categoryId: string | null;
	date: Date;
}

/**
 * Fetches the current user's shares of shared expenses for a date range.
 * Returns data in a format compatible with personal expense aggregation.
 *
 * Used by: budget service, stats service, dashboard
 */
export async function getSharedExpenseShares(
	db: AppDb,
	userId: string,
	dateFilter?: { gte?: Date; lte?: Date },
	rateCache?: RateCache,
	excludedProjectIds?: string[],
): Promise<SharedExpenseShare[]> {
	const whereTransaction: Prisma.SharedTransactionWhereInput = {
		...(dateFilter ? { date: dateFilter } : {}),
		...excludedProjectFilter(excludedProjectIds),
	};

	const participations = await (db as PrismaClient).splitParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			transaction: whereTransaction,
		},
		select: {
			shareAmount: true,
			transaction: {
				select: {
					currency: true,
					date: true,
					categoryId: true,
				},
			},
		},
	});

	if (participations.length === 0) return [];

	// Batch compute exchange rates for currency conversion
	const currencies = [
		...new Set(participations.map((p) => p.transaction.currency)),
	];
	const localRateCache = new Map<string, { rate: number; type: string | null }>();

	if (rateCache) {
		const rateMap = await rateCache.getMany(currencies, new Date());
		for (const [currency, rate] of rateMap) {
			localRateCache.set(currency, rate ?? { rate: 1, type: null });
		}
	} else {
		const nonUsdCurrencies = currencies.filter((c) => c !== "USD");
		localRateCache.set("USD", { rate: 1, type: null });
		const fetchedRates = await Promise.all(
			nonUsdCurrencies.map((c) => getBestExchangeRate(db as PrismaClient, c, new Date())),
		);
		for (let i = 0; i < nonUsdCurrencies.length; i++) {
			localRateCache.set(nonUsdCurrencies[i]!, fetchedRates[i] ?? { rate: 1, type: null });
		}
	}

	return participations.map((p) => {
		const shareAmount = Number(p.shareAmount);
		const currency = p.transaction.currency;
		const rateData = localRateCache.get(currency) ?? { rate: 1, type: null };

		return {
			amount: shareAmount,
			currency,
			amountInUSD: toUSD(shareAmount, currency, rateData.rate),
			categoryId: p.transaction.categoryId,
			date: p.transaction.date,
		};
	});
}

/**
 * Computes aggregate USD total of user's shared expense shares.
 * Used for simple total computations (stats, dashboard).
 */
export async function getSharedExpenseTotalInUSD(
	db: AppDb,
	userId: string,
	dateFilter?: { gte?: Date; lte?: Date },
	rateCache?: RateCache,
	excludedProjectIds?: string[],
): Promise<number> {
	const shares = await getSharedExpenseShares(db, userId, dateFilter, rateCache, excludedProjectIds);
	return shares.reduce((sum, s) => sum + s.amountInUSD, 0);
}

/**
 * Full shared participation details for the transactions page.
 * Returns enriched records with payer info and participant count.
 */
export async function listSharedParticipationsForUser(
	db: AppDb,
	userId: string,
	excludedProjectIds?: string[],
) {
	const transactionFilter = excludedProjectFilter(excludedProjectIds);

	const participations = await (db as PrismaClient).splitParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			...(transactionFilter ? { transaction: transactionFilter } : {}),
		},
		select: {
			shareAmount: true,
			transaction: {
				select: {
					id: true,
					description: true,
					amount: true,
					currency: true,
					date: true,
					categoryId: true,
					category: {
						select: { id: true, name: true, color: true, icon: true },
					},
					paidByType: true,
					paidById: true,
					projectId: true,
					createdByType: true,
					createdById: true,
					isLocked: true,
					splitParticipants: {
						select: {
							participantType: true,
							participantId: true,
							shareAmount: true,
						},
					},
				},
			},
		},
	});

	if (participations.length === 0) return [];

	// Batch-resolve all participant identities (payers + split participants)
	const allParticipantKeys = new Set<string>();
	const userIds = new Set<string>();
	const shadowIds = new Set<string>();
	const guestIds = new Set<string>();

	for (const p of participations) {
		const tx = p.transaction;
		// Payer
		const payerKey = `${tx.paidByType}:${tx.paidById}`;
		if (!allParticipantKeys.has(payerKey)) {
			allParticipantKeys.add(payerKey);
			if (tx.paidByType === "user") userIds.add(tx.paidById);
			else if (tx.paidByType === "shadow") shadowIds.add(tx.paidById);
			else if (tx.paidByType === "guest") guestIds.add(tx.paidById);
		}
		// Split participants
		for (const sp of tx.splitParticipants) {
			const spKey = `${sp.participantType}:${sp.participantId}`;
			if (!allParticipantKeys.has(spKey)) {
				allParticipantKeys.add(spKey);
				if (sp.participantType === "user") userIds.add(sp.participantId);
				else if (sp.participantType === "shadow") shadowIds.add(sp.participantId);
				else if (sp.participantType === "guest") guestIds.add(sp.participantId);
			}
		}
	}

	const [resolvedUsers, resolvedShadows, resolvedGuests] = await Promise.all([
		userIds.size > 0
			? (db as PrismaClient).user.findMany({
					where: { id: { in: [...userIds] } },
					select: { id: true, name: true, image: true, avatarPath: true },
				})
			: [],
		shadowIds.size > 0
			? (db as PrismaClient).shadowProfile.findMany({
					where: { id: { in: [...shadowIds] } },
					select: { id: true, name: true },
				})
			: [],
		guestIds.size > 0
			? (db as PrismaClient).guestSession.findMany({
					where: { id: { in: [...guestIds] } },
					select: { id: true, name: true },
				})
			: [],
	]);

	const nameMap = new Map<string, string>();
	const avatarMap = new Map<string, string | null>();
	for (const u of resolvedUsers) {
		nameMap.set(`user:${u.id}`, u.name ?? "Unknown");
		avatarMap.set(`user:${u.id}`, u.avatarPath ? `/api/images/${u.avatarPath}` : null);
	}
	for (const s of resolvedShadows) nameMap.set(`shadow:${s.id}`, s.name);
	for (const g of resolvedGuests) nameMap.set(`guest:${g.id}`, g.name);

	// Compute amountInUSD for each share — batch fetch rates in parallel
	const currencies = [
		...new Set(participations.map((p) => p.transaction.currency)),
	];
	const nonUsdCurrencies = currencies.filter((c) => c !== "USD");
	const fetchedRates = await Promise.all(
		nonUsdCurrencies.map((c) => getBestExchangeRate(db as PrismaClient, c, new Date())),
	);
	const rateCache = new Map<string, { rate: number; type: string | null }>();
	rateCache.set("USD", { rate: 1, type: null });
	for (let i = 0; i < nonUsdCurrencies.length; i++) {
		rateCache.set(nonUsdCurrencies[i]!, fetchedRates[i] ?? { rate: 1, type: null });
	}

	// Resolve project names in batch
	const projectIds = [
		...new Set(
			participations
				.map((p) => p.transaction.projectId)
				.filter((id): id is string => !!id),
		),
	];
	const projects =
		projectIds.length > 0
			? await (db as PrismaClient).project.findMany({
					where: { id: { in: projectIds } },
					select: { id: true, name: true },
				})
			: [];
	const projectMap = new Map(projects.map((p) => [p.id, p.name]));

	// Batch-fetch user's project roles for permission checks
	const projectRoleMap = new Map<string, string>();
	if (projectIds.length > 0) {
		const memberships = await (db as PrismaClient).projectParticipant.findMany({
			where: {
				projectId: { in: projectIds },
				participantType: "user",
				participantId: userId,
			},
			select: { projectId: true, role: true },
		});
		for (const m of memberships) {
			projectRoleMap.set(m.projectId, m.role);
		}
	}

	return participations.map((p) => {
		const tx = p.transaction;
		const shareAmount = Number(p.shareAmount);
		const currency = tx.currency;
		const rateData = rateCache.get(currency) ?? { rate: 1, type: null };

		const amountInUSD = toUSD(shareAmount, currency, rateData.rate);

		const payerKey = `${tx.paidByType}:${tx.paidById}`;
		const paidByName = nameMap.get(payerKey) ?? "Unknown";
		const paidByAvatarUrl = avatarMap.get(payerKey) ?? null;
		const participantCount = tx.splitParticipants.length;
		const iPayedThis = tx.paidByType === "user" && tx.paidById === userId;

		// Compute edit/delete permissions
		const isCreator = tx.createdByType === "user" && tx.createdById === userId;
		let canEdit = false;
		let canDelete = false;
		if (!tx.isLocked) {
			if (tx.projectId) {
				const role = projectRoleMap.get(tx.projectId);
				if (role === "ORGANIZER" || role === "EDITOR") {
					canEdit = true;
					canDelete = true;
				} else if (role === "CONTRIBUTOR" && isCreator) {
					canEdit = true;
					canDelete = true;
				}
			} else if (isCreator) {
				canEdit = true;
				canDelete = true;
			}
		}

		return {
			id: `shared:${tx.id}`,
			description: tx.description,
			amount: shareAmount,
			currency,
			exchangeRate: rateData.rate !== 1 ? rateData.rate : null,
			amountInUSD,
			date: tx.date,
			categoryId: tx.categoryId,
			category: tx.category,
			source: "shared" as const,
			sharedContext: {
				totalAmount: Number(tx.amount),
				participantCount,
				paidByName,
				paidByAvatarUrl,
				iPayedThis,
				transactionId: tx.id,
				projectId: tx.projectId ?? undefined,
				projectName: tx.projectId
					? (projectMap.get(tx.projectId) ?? undefined)
					: undefined,
				canEdit,
				canDelete,
				splitParticipants: tx.splitParticipants.map((sp) => {
					const spKey = `${sp.participantType}:${sp.participantId}`;
					return {
						participantType: sp.participantType,
						participantId: sp.participantId,
						shareAmount: Number(sp.shareAmount),
						name: nameMap.get(spKey) ?? "Unknown",
						avatarUrl: avatarMap.get(spKey) ?? null,
					};
				}),
			},
		};
	});
}
