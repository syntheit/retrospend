import type { Prisma } from "~prisma";

/**
 * The rate a row was booked at, unrounded: units of `homeCurrency` per 1 unit
 * of the row's currency (homeRate, 12 decimals), when it was booked in
 * `homeCurrency`. Clients word it with formatRate; null when no rate was
 * booked in that home.
 */
export function bookedRate(
	row: {
		homeCurrency: string | null;
		homeRate: Prisma.Decimal | null;
	},
	homeCurrency: string,
): string | null {
	if (row.homeCurrency !== homeCurrency || row.homeRate === null) return null;
	return row.homeRate.toString();
}
