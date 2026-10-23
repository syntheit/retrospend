import type { Session } from "~/server/better-auth/config";
import { getAppSettings } from "~/server/services/settings";
import type { FeatureFlagMode } from "~prisma";

/** Rollout flags of the UI overhaul (IMPLEMENTATION §6.4). */
export type FeatureFlag = "uiV2" | "envelopeBudget" | "apiV1";

const FLAG_COLUMNS = {
	uiV2: "uiV2Mode",
	envelopeBudget: "envelopeBudgetMode",
	apiV1: "apiV1Mode",
} as const satisfies Record<FeatureFlag, string>;

// All three columns exist (M13 and M6's envelopeBudgetMode). They stay
// optional here so settings cached or mocked without a column read as OFF:
// a flag never turns on by accident.
type FlagColumns = Partial<
	Record<(typeof FLAG_COLUMNS)[FeatureFlag], FeatureFlagMode>
>;

/** The signed-in user, or null/undefined when signed out. */
export type FlagViewer = Pick<Session["user"], "role"> | null | undefined;

/**
 * Whether `flag` is on for this viewer. ADMINS means the ADMIN role only,
 * and a signed-out viewer only sees flags set to ALL. Reads the cached app
 * settings, so a change shows up within the settings cache TTL.
 */
export async function isFlagEnabled(
	flag: FeatureFlag,
	viewer: FlagViewer,
): Promise<boolean> {
	const settings: FlagColumns = await getAppSettings();
	const mode = settings[FLAG_COLUMNS[flag]] ?? "OFF";
	switch (mode) {
		case "ALL":
			return true;
		case "ADMINS":
			return viewer?.role === "ADMIN";
		case "OFF":
			return false;
	}
}
