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
import { fromUSD, toUSD } from "../currency";
import { getBestExchangeRate } from "../api/routers/shared-currency";
import { computeBalance, computeBalanceBatch } from "./shared-expenses/balance";
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
						},
					},
				},
			},
		},
	});

	if (participations.length === 0) return [];

	// Resolve payer names in batch
	const payerUserIds = [
		...new Set(
			participations
				.filter((p) => p.transaction.paidByType === "user")
				.map((p) => p.transaction.paidById),
		),
	];
	const payerShadowIds = [
		...new Set(
			participations
				.filter((p) => p.transaction.paidByType === "shadow")
				.map((p) => p.transaction.paidById),
		),
	];

	const [payerUsers, payerShadows] = await Promise.all([
		payerUserIds.length > 0
			? (db as PrismaClient).user.findMany({
					where: { id: { in: payerUserIds } },
					select: { id: true, name: true, avatarPath: true },
				})
			: [],
		payerShadowIds.length > 0
			? (db as PrismaClient).shadowProfile.findMany({
					where: { id: { in: payerShadowIds } },
					select: { id: true, name: true },
				})
			: [],
	]);

	const nameMap = new Map<string, string>();
	const avatarMap = new Map<string, string | null>();
	for (const u of payerUsers) {
		nameMap.set(`user:${u.id}`, u.name ?? "Unknown");
		avatarMap.set(`user:${u.id}`, u.avatarPath ? `/api/images/${u.avatarPath}` : null);
	}
	for (const s of payerShadows) nameMap.set(`shadow:${s.id}`, s.name);

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
			},
		};
	});
}

/**
 * Computes aggregate shared receivables and payables in USD.
 * Receivables = money owed TO the user (positive balances).
 * Payables = money the user OWES (negative balances).
 *
 * Used by: wealth dashboard
 */
export async function getSharedBalanceSummary(
	db: AppDb,
	userId: string,
): Promise<{ receivablesUSD: number; payablesUSD: number }> {
	const prisma = db as PrismaClient;

	// Find all unique contacts (participants the user has transacted with)
	const transactions = await prisma.sharedTransaction.findMany({
		where: {
			splitParticipants: {
				some: { participantType: "user", participantId: userId },
			},
		},
		select: {
			splitParticipants: {
				select: {
					participantType: true,
					participantId: true,
				},
			},
		},
	});

	if (transactions.length === 0) {
		return { receivablesUSD: 0, payablesUSD: 0 };
	}

	// Collect unique contacts
	const contactKeys = new Set<string>();
	for (const tx of transactions) {
		for (const sp of tx.splitParticipants) {
			if (sp.participantType === "user" && sp.participantId === userId)
				continue;
			contactKeys.add(`${sp.participantType}:${sp.participantId}`);
		}
	}

	if (contactKeys.size === 0) {
		return { receivablesUSD: 0, payablesUSD: 0 };
	}

	const userRef = { participantType: "user" as const, participantId: userId };

	// Parse contact keys into ParticipantRef[]
	const counterparts = [...contactKeys].map((key) => {
		const [type, ...idParts] = key.split(":");
		return {
			participantType: type as "user" | "guest" | "shadow",
			participantId: idParts.join(":"),
		};
	});

	// Batch compute all balances in 4 queries total (instead of 4N)
	const balances = await computeBalanceBatch(prisma, userRef, counterparts);

	// Collect all currencies needed for rate conversion
	const allCurrencies = new Set<string>();
	for (const balance of balances) {
		for (const currency of Object.keys(balance.byCurrency)) {
			allCurrencies.add(currency);
		}
	}

	// Batch fetch exchange rates
	const localRateCache = new Map<string, { rate: number; type: string | null }>();
	localRateCache.set("USD", { rate: 1, type: null });
	const uncachedCurrencies = [...allCurrencies].filter((c) => c !== "USD");
	if (uncachedCurrencies.length > 0) {
		const rates = await Promise.all(
			uncachedCurrencies.map((c) => getBestExchangeRate(prisma, c, new Date())),
		);
		for (let i = 0; i < uncachedCurrencies.length; i++) {
			localRateCache.set(
				uncachedCurrencies[i]!,
				rates[i] ?? { rate: 1, type: null },
			);
		}
	}

	let totalReceivablesUSD = 0;
	let totalPayablesUSD = 0;

	for (const balance of balances) {
		for (const [currency, amount] of Object.entries(balance.byCurrency)) {
			const rateData = localRateCache.get(currency) ?? { rate: 1, type: null };
			const absAmount = Math.abs(amount);
			const amountInUSD = toUSD(absAmount, currency, rateData.rate);

			if (amount > 0) {
				totalReceivablesUSD += amountInUSD;
			} else if (amount < 0) {
				totalPayablesUSD += amountInUSD;
			}
		}
	}

	return {
		receivablesUSD: totalReceivablesUSD,
		payablesUSD: totalPayablesUSD,
	};
}
