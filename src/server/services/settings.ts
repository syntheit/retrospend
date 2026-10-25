import { db } from "~/server/db";

const SETTINGS_ID = "app_settings_singleton";
const CACHE_TTL_MS = 60_000; // 60 seconds

export interface AppSettings {
	id: string;
	inviteOnlyEnabled: boolean;
	allowAllUsersToGenerateInvites: boolean;
	enableEmail: boolean;
	defaultAiMode: "LOCAL" | "EXTERNAL";
	externalAiAccessMode: "WHITELIST" | "BLACKLIST";
	monthlyAiTokenQuota: number;
	monthlyLocalAiTokenQuota: number;
	monthlyExternalAiTokenQuota: number;
	auditPrivacyMode: "MINIMAL" | "ANONYMIZED" | "FULL";
	maxConcurrentImportJobs: number;
	enableFeedback: boolean;
	webhooksAllowPrivateTargets: boolean;
	createdAt: Date;
	updatedAt: Date;
}

// Next bundles route handlers and pages separately, each with its own copy
// of this module, so a module-level cache let an admin write refresh only
// the copy that served it: pages kept the old flags for up to a minute. The
// cache lives on globalThis, one per server process, like the Prisma client.
const cache = globalThis as unknown as {
	retrospendAppSettings?: { data: AppSettings; expiry: number };
};

/**
 * Get the current app settings, creating default settings if none exist.
 * Results are cached in-memory for 60 seconds.
 */
export async function getAppSettings(): Promise<AppSettings> {
	const cached = cache.retrospendAppSettings;
	if (cached && Date.now() < cached.expiry) {
		return cached.data;
	}

	const settings = await db.appSettings.upsert({
		where: { id: SETTINGS_ID },
		update: {},
		create: {
			id: SETTINGS_ID,
			inviteOnlyEnabled: false,
			allowAllUsersToGenerateInvites: false,
			enableEmail: true,
		},
	});

	cache.retrospendAppSettings = {
		data: settings,
		expiry: Date.now() + CACHE_TTL_MS,
	};
	return settings;
}

/**
 * Update app settings. Invalidates the cache immediately.
 */
export async function updateAppSettings(updates: {
	inviteOnlyEnabled?: boolean;
	allowAllUsersToGenerateInvites?: boolean;
	enableEmail?: boolean;
	defaultAiMode?: "LOCAL" | "EXTERNAL";
	externalAiAccessMode?: "WHITELIST" | "BLACKLIST";
	monthlyAiTokenQuota?: number;
	monthlyLocalAiTokenQuota?: number;
	monthlyExternalAiTokenQuota?: number;
	auditPrivacyMode?: "MINIMAL" | "ANONYMIZED" | "FULL";
	maxConcurrentImportJobs?: number;
	enableFeedback?: boolean;
	webhooksAllowPrivateTargets?: boolean;
}): Promise<AppSettings> {
	const settings = await db.appSettings.upsert({
		where: { id: SETTINGS_ID },
		update: {
			...updates,
		},
		// Every update applies on create too: listing a few fields here once
		// dropped the rest when the row did not exist yet.
		create: {
			id: SETTINGS_ID,
			inviteOnlyEnabled: false,
			allowAllUsersToGenerateInvites: false,
			enableEmail: true,
			...updates,
		},
	});

	cache.retrospendAppSettings = {
		data: settings,
		expiry: Date.now() + CACHE_TTL_MS,
	};
	return settings;
}

/**
 * Check if invite-only mode is enabled
 */
export async function isInviteOnlyEnabled(): Promise<boolean> {
	const settings = await getAppSettings();
	return settings.inviteOnlyEnabled;
}

/**
 * Check if all users are allowed to generate invite codes
 */
export async function isAllowAllUsersToGenerateInvitesEnabled(): Promise<boolean> {
	const settings = await getAppSettings();
	return settings.allowAllUsersToGenerateInvites;
}
