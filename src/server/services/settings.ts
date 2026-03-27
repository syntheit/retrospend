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
	createdAt: Date;
	updatedAt: Date;
}

let cachedSettings: { data: AppSettings; expiry: number } | null = null;

/**
 * Get the current app settings, creating default settings if none exist.
 * Results are cached in-memory for 60 seconds.
 */
export async function getAppSettings(): Promise<AppSettings> {
	if (cachedSettings && Date.now() < cachedSettings.expiry) {
		return cachedSettings.data;
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

	cachedSettings = { data: settings, expiry: Date.now() + CACHE_TTL_MS };
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
}): Promise<AppSettings> {
	const settings = await db.appSettings.upsert({
		where: { id: SETTINGS_ID },
		update: {
			...updates,
		},
		create: {
			id: SETTINGS_ID,
			inviteOnlyEnabled: updates.inviteOnlyEnabled ?? false,
			allowAllUsersToGenerateInvites:
				updates.allowAllUsersToGenerateInvites ?? false,
			enableEmail: updates.enableEmail ?? true,
		},
	});

	cachedSettings = { data: settings, expiry: Date.now() + CACHE_TTL_MS };
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
