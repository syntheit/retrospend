/**
 * Shared Expense Integration
 *
 * Provides helper functions for integrating shared expense data into
 * personal finance views (transactions, budgets, stats, wealth).
 *
 * IMPORTANT: These functions return the CURRENT USER'S SHARE only,
 * never the full transaction amount.
 */
import { computeAmountInUSD, USD } from "~/lib/money";
import type { Prisma, PrismaClient } from "~prisma";
import { findExchangeRatesForDates } from "../exchange-rates";
import {
	buildCallerRoleMap,
	deriveCanModify,
} from "./shared-expenses/project-permissions";
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

type ShareRateSource = {
	currency: string;
	date: Date;
	exchangeRate: Prisma.Decimal | number | null;
};

/**
 * Rate for each shared expense: the one captured when it was saved, else the
 * nearest table rate for its own date (never today's rate for a past month,
 * never 1). Null only for a currency with no rate at all.
 */
async function shareRateResolver(db: AppDb, rows: ShareRateSource[]) {
	const lookup = await findExchangeRatesForDates(
		db,
		rows
			.filter((r) => r.exchangeRate === null && r.currency !== USD)
			.map((r) => r.currency),
	);
	return (row: ShareRateSource): number | null => {
		if (row.currency === USD) return 1;
		if (row.exchangeRate !== null) return Number(row.exchangeRate);
		return lookup(row.currency, row.date)?.rate ?? null;
	};
}

/**
 * USD value of a share. A currency with no rate at all throws
 * MissingRateError, like every other total under the totals rule: a share
 * is never counted as 0.
 */
function shareToUSD(amount: number, currency: string, rate: number | null) {
	return computeAmountInUSD(amount, currency, rate);
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
	// Kept for callers; rates are now resolved per transaction date in one
	// batched lookup instead of today's rate from the cache.
	_rateCache?: RateCache,
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
			// A share the user rejected is not their spending. Pending shares
			// still count until they are accepted or rejected.
			verificationStatus: { not: "REJECTED" },
			transaction: whereTransaction,
		},
		select: {
			shareAmount: true,
			transaction: {
				select: {
					currency: true,
					date: true,
					categoryId: true,
					exchangeRate: true,
					category: { select: { userId: true } },
				},
			},
		},
	});

	if (participations.length === 0) return [];

	const rateFor = await shareRateResolver(
		db,
		participations.map((p) => p.transaction),
	);

	return participations.map((p) => {
		const shareAmount = Number(p.shareAmount);
		const currency = p.transaction.currency;

		return {
			amount: shareAmount,
			currency,
			amountInUSD: shareToUSD(shareAmount, currency, rateFor(p.transaction)),
			// The category belongs to whoever created the expense. Another
			// participant's budgets and breakdowns cannot use it: uncategorized.
			categoryId:
				p.transaction.category?.userId === userId
					? p.transaction.categoryId
					: null,
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
			verificationStatus: true,
			transaction: {
				select: {
					id: true,
					description: true,
					amount: true,
					currency: true,
					date: true,
					categoryId: true,
					exchangeRate: true,
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

	// Each share converts at its own transaction's rate.
	const rateFor = await shareRateResolver(
		db,
		participations.map((p) => p.transaction),
	);

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

	// Batch-fetch user's project roles for permission checks. ORGANIZER/EDITOR
	// get edit/delete on every project expense; CONTRIBUTOR only their own.
	const projectRoleMap = await buildCallerRoleMap(
		db,
		[{ participantType: "user", participantId: userId }],
		projectIds,
	);

	return participations.map((p) => {
		const tx = p.transaction;
		const shareAmount = Number(p.shareAmount);
		const currency = tx.currency;
		const rate = rateFor(tx);
		// The feed lists every share; one with no rate shows as "no rate"
		// (null, as for personal expenses) instead of failing the whole list.
		const amountInUSD =
			rate === null ? null : shareToUSD(shareAmount, currency, rate);

		const payerKey = `${tx.paidByType}:${tx.paidById}`;
		const paidByName = nameMap.get(payerKey) ?? "Unknown";
		const paidByAvatarUrl = avatarMap.get(payerKey) ?? null;
		const participantCount = tx.splitParticipants.length;
		const iPayedThis = tx.paidByType === "user" && tx.paidById === userId;

		// Compute edit/delete permissions
		const isCreator = tx.createdByType === "user" && tx.createdById === userId;
		const canModify = deriveCanModify({
			isLocked: tx.isLocked,
			projectId: tx.projectId,
			isCreator,
			roleMap: projectRoleMap,
		});
		const canEdit = canModify;
		const canDelete = canModify;

		return {
			id: `shared:${tx.id}`,
			description: tx.description,
			amount: shareAmount,
			currency,
			exchangeRate: currency === USD ? null : rate,
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
				paidByType: tx.paidByType,
				paidById: tx.paidById,
				iPayedThis,
				transactionId: tx.id,
				projectId: tx.projectId ?? undefined,
				projectName: tx.projectId
					? (projectMap.get(tx.projectId) ?? undefined)
					: undefined,
				canEdit,
				canDelete,
				isCreator,
				myVerificationStatus: p.verificationStatus,
				isLocked: tx.isLocked,
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
