import { db } from "~/server/db";

const SETTINGS_ID = "app_settings_singleton";

export interface AppSettings {
  id: string;
  inviteOnlyEnabled: boolean;
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
    },
  });
}

/**
 * Update app settings
 */
export async function updateAppSettings(updates: {
  inviteOnlyEnabled?: boolean;
}): Promise<AppSettings> {
  return await db.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {
      ...updates,
    },
    create: {
      id: SETTINGS_ID,
      inviteOnlyEnabled: updates.inviteOnlyEnabled ?? false,
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
