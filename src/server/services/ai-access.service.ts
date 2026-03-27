import { env } from "~/env";
import type { Prisma, PrismaClient } from "~prisma";
import { getAppSettings } from "./settings";

interface AiAccessResult {
	allowed: boolean;
	reason?: string;
	effectiveMode: "LOCAL" | "EXTERNAL";
	quotaRemaining: number | null;
}

/**
 * Resolves which AI mode a user should use and whether they have quota.
 *
 * For EXTERNAL requests: checks access control + external quota, falls back
 * to LOCAL if denied. For LOCAL requests (or fallback): checks local quota.
 * Returns allowed=false only when no mode has remaining quota.
 */
export async function resolveAiAccess(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
	requestedMode: "LOCAL" | "EXTERNAL",
): Promise<AiAccessResult> {
	let effectiveMode: "LOCAL" | "EXTERNAL" = "LOCAL";
	let externalDeniedReason: string | undefined;

	if (requestedMode === "EXTERNAL") {
		// Check if OpenRouter API key is configured
		if (!env.OPENROUTER_API_KEY) {
			externalDeniedReason =
				"External AI is not configured on this instance";
		} else {
			// Get user's per-user override and role
			const user = await db.user.findUnique({
				where: { id: userId },
				select: { externalAiAllowed: true, role: true },
			});

			if (!user) {
				return {
					allowed: false,
					reason: "User not found",
					effectiveMode: "LOCAL",
					quotaRemaining: null,
				};
			}

			if (user.role === "ADMIN") {
				// Admins bypass access control and quota
				return {
					allowed: true,
					effectiveMode: "EXTERNAL",
					quotaRemaining: null,
				};
			}

			if (user.externalAiAllowed === false) {
				externalDeniedReason =
					"External AI access has been revoked by an admin";
			} else {
				const settings = await getAppSettings();

				if (
					user.externalAiAllowed === null &&
					settings.externalAiAccessMode === "WHITELIST"
				) {
					externalDeniedReason =
						"External AI access requires admin approval (whitelist mode)";
				} else {
					// Access granted - check external quota
					const yearMonth = getCurrentYearMonth();
					const usage = await db.aiUsage.findUnique({
						where: { userId_yearMonth: { userId, yearMonth } },
					});
					const tokensUsed = usage?.externalTokensUsed ?? 0;
					const remaining =
						settings.monthlyExternalAiTokenQuota - tokensUsed;

					if (remaining <= 0) {
						externalDeniedReason =
							"Monthly external AI token quota exceeded";
					} else {
						effectiveMode = "EXTERNAL";
						return {
							allowed: true,
							effectiveMode: "EXTERNAL",
							quotaRemaining: remaining,
						};
					}
				}
			}
		}
	}

	// Effective mode is LOCAL (either requested or fell back from EXTERNAL)
	// Check local quota
	const settings = await getAppSettings();
	const yearMonth = getCurrentYearMonth();
	const usage = await db.aiUsage.findUnique({
		where: { userId_yearMonth: { userId, yearMonth } },
	});
	const localUsed = usage?.localTokensUsed ?? 0;
	const localRemaining = settings.monthlyLocalAiTokenQuota - localUsed;

	if (localRemaining <= 0) {
		return {
			allowed: false,
			reason:
				externalDeniedReason
					? `${externalDeniedReason}, and monthly local AI token quota exceeded`
					: "Monthly local AI token quota exceeded",
			effectiveMode: "LOCAL",
			quotaRemaining: 0,
		};
	}

	return {
		allowed: true,
		effectiveMode: "LOCAL",
		quotaRemaining: localRemaining,
	};
}

/**
 * Records token usage for a user (atomic upsert).
 */
export async function recordTokenUsage(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
	tokensUsed: number,
	provider: "local" | "external",
): Promise<void> {
	if (tokensUsed <= 0) return;

	const yearMonth = getCurrentYearMonth();

	const fieldUpdate =
		provider === "external"
			? { externalTokensUsed: { increment: tokensUsed } }
			: { localTokensUsed: { increment: tokensUsed } };

	const fieldCreate =
		provider === "external"
			? { externalTokensUsed: tokensUsed }
			: { localTokensUsed: tokensUsed };

	await db.aiUsage.upsert({
		where: { userId_yearMonth: { userId, yearMonth } },
		update: {
			...fieldUpdate,
			tokensUsed: { increment: tokensUsed },
		},
		create: {
			userId,
			yearMonth,
			tokensUsed,
			...fieldCreate,
		},
	});
}

/**
 * Gets AI usage summary for admin view.
 */
export async function getAiUsageSummary(
	db: PrismaClient | Prisma.TransactionClient,
	yearMonth?: string,
) {
	const targetMonth = yearMonth ?? getCurrentYearMonth();

	const usages = await db.aiUsage.findMany({
		where: { yearMonth: targetMonth },
		include: {
			user: {
				select: { id: true, username: true },
			},
		},
		orderBy: { tokensUsed: "desc" },
	});

	return usages;
}

function getCurrentYearMonth(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	return `${year}-${month}`;
}
