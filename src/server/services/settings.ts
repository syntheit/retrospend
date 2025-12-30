import { db } from "~/server/db";

const SETTINGS_ID = "app_settings_singleton";

export interface AppSettings {
	id: string;
	inviteOnlyEnabled: boolean;
	allowAllUsersToGenerateInvites: boolean;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Get the current app settings, creating default settings if none exist
 */
export async function getAppSettings(): Promise<AppSettings> {
	return await db.appSettings.upsert({
		where: { id: SETTINGS_ID },
		update: {},
		create: {
			id: SETTINGS_ID,
			inviteOnlyEnabled: false,
			allowAllUsersToGenerateInvites: false,
		},
	});
}

/**
 * Update app settings
 */
export async function updateAppSettings(updates: {
	inviteOnlyEnabled?: boolean;
	allowAllUsersToGenerateInvites?: boolean;
}): Promise<AppSettings> {
	return await db.appSettings.upsert({
		where: { id: SETTINGS_ID },
		update: {
			...updates,
		},
		create: {
			id: SETTINGS_ID,
			inviteOnlyEnabled: updates.inviteOnlyEnabled ?? false,
			allowAllUsersToGenerateInvites:
				updates.allowAllUsersToGenerateInvites ?? false,
		},
	});
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
