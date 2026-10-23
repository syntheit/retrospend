/**
 * View in Activity: Activity on the days an import's rows landed on, so they
 * are on screen even when they are not this month (import.html T5-8).
 * Activity has no filter by import yet (GAPS), so the days stand in for it.
 */
export function activityHref(from: string, to: string): string {
	const q = new URLSearchParams({ from, to });
	return `/activity?${q.toString()}`;
}
