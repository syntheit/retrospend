import {
	type BackgroundSettings,
	backgroundSettingsSchema,
	defaultBackgroundSettings,
} from "~/lib/background-settings";
import type { PrismaClient } from "~prisma";

/** The profile page background, or the default when none is saved or it no longer parses. */
export async function getProfileBackground(
	db: PrismaClient,
	userId: string,
): Promise<BackgroundSettings> {
	const setting = await db.userPageSetting.findUnique({
		where: { userId_page: { userId, page: "PROFILE" } },
		select: { settings: true },
	});
	if (!setting) return defaultBackgroundSettings;
	const parsed = backgroundSettingsSchema.safeParse(setting.settings);
	return parsed.success ? parsed.data : defaultBackgroundSettings;
}

export async function saveProfileBackground(
	db: PrismaClient,
	userId: string,
	settings: BackgroundSettings,
): Promise<void> {
	await db.userPageSetting.upsert({
		where: { userId_page: { userId, page: "PROFILE" } },
		create: { userId, page: "PROFILE", settings },
		update: { settings },
	});
}
