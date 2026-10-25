/**
 * The day of the oldest spending a person has, in their calendar: where All
 * time starts on the Insights page. It reads the same rows as every other
 * Insights number (spentItems, grouped by day), so All time never reaches
 * before the first expense or share that counts.
 */
import { dayKey } from "@retrospend/domain/time-zone";
import type { FigureDb } from "~/server/figures/registry";
import { spentItems } from "~/server/services/figures/spent";
import { insightsContext } from "./context";

export async function firstDayIn(
	db: FigureDb,
	userId: string,
	options: { timeZone?: string; now?: Date } = {},
): Promise<{ readonly day: string | null }> {
	const ctx = await insightsContext(db, userId, options);
	const items = await spentItems(db, { userId }, "day");
	const oldest = items.reduce<Date | null>(
		(min, item) =>
			item.date && (!min || item.date.getTime() < min.getTime())
				? item.date
				: min,
		null,
	);
	return { day: oldest ? dayKey(oldest, ctx.zone) : null };
}
