import { normalizeTimeZone } from "~/lib/time-zone";

/** Until users pick a zone, server-side days are read in Buenos Aires. */
export const FALLBACK_TIME_ZONE = "America/Argentina/Buenos_Aires";

/**
 * The one place the server decides which time zone a user's calendar days
 * are in (membership dates, "before they joined"). Async so the per-user
 * setting can be read here later without touching any caller.
 *
 * TODO: read the user's own zone once the setting exists (docs/ui/GAPS.md §7).
 */
export async function userTimeZone(_userId: string | null): Promise<string> {
	return normalizeTimeZone(process.env.DEFAULT_TIME_ZONE) ?? FALLBACK_TIME_ZONE;
}
