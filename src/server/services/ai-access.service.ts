import type { PrismaClient, Prisma } from "~prisma";
import { env } from "~/env";
import { getAppSettings } from "./settings";

interface AiAccessResult {
	allowed: boolean;
	reason?: string;
	effectiveMode: "LOCAL" | "EXTERNAL";
	quotaRemaining: number | null;
}

/**
 * Resolves whether a user can use external AI for a given request.
 */
export async function resolveAiAccess(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
	requestedMode: "LOCAL" | "EXTERNAL",
): Promise<AiAccessResult> {
	// Local mode is always allowed
	if (requestedMode === "LOCAL") {
		return { allowed: true, effectiveMode: "LOCAL", quotaRemaining: null };
	}

	// Check if OpenRouter API key is configured
	if (!env.OPENROUTER_API_KEY) {
		return {
			allowed: false,
			reason: "External AI is not configured on this instance",
			effectiveMode: "LOCAL",
			quotaRemaining: null,
		};
	}

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

	// Admins are always allowed (bypass access control and quota)
	if (user.role === "ADMIN") {
		return { allowed: true, effectiveMode: "EXTERNAL", quotaRemaining: null };
	}

	// Per-user override takes priority
	if (user.externalAiAllowed === false) {
		return {
			allowed: false,
			reason: "External AI access has been revoked by an admin",
			effectiveMode: "LOCAL",
			quotaRemaining: null,
		};
	}

	const settings = await getAppSettings();

	if (user.externalAiAllowed === null) {
		// Inherit from global setting
		if (settings.externalAiAccessMode === "WHITELIST") {
			return {
				allowed: false,
				reason:
					"External AI access requires admin approval (whitelist mode)",
				effectiveMode: "LOCAL",
				quotaRemaining: null,
			};
		}
		// BLACKLIST mode: allowed by default
	}
	// user.externalAiAllowed === true → explicitly allowed

	// Check monthly quota
	const yearMonth = getCurrentYearMonth();
	const usage = await db.aiUsage.findUnique({
		where: { userId_yearMonth: { userId, yearMonth } },
	});

	const tokensUsed = usage?.tokensUsed ?? 0;
	const quota = settings.monthlyAiTokenQuota;
	const remaining = quota - tokensUsed;

	if (remaining <= 0) {
		return {
			allowed: false,
			reason: "Monthly AI token quota exceeded",
			effectiveMode: "LOCAL",
			quotaRemaining: 0,
		};
	}

	return {
		allowed: true,
		effectiveMode: "EXTERNAL",
		quotaRemaining: remaining,
	};
}

/**
 * Records token usage for a user (atomic upsert).
 */
export async function recordTokenUsage(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
	tokensUsed: number,
): Promise<void> {
	if (tokensUsed <= 0) return;

	const yearMonth = getCurrentYearMonth();

	await db.aiUsage.upsert({
		where: { userId_yearMonth: { userId, yearMonth } },
		update: { tokensUsed: { increment: tokensUsed } },
		create: {
			userId,
			yearMonth,
			tokensUsed,
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
