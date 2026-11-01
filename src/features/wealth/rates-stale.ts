/**
 * Whether the newest rates are old enough to say so. Both dates are the
 * server's UTC days, which can differ from the person's day by one, so rates
 * from yesterday still count as fresh: only a gap of more than one day shows.
 */
export function ratesAreStale(
	ratesUpdated: string | null,
	today: string,
): boolean {
	if (!ratesUpdated) return false;
	const days =
		(Date.parse(`${today}T00:00:00Z`) -
			Date.parse(`${ratesUpdated}T00:00:00Z`)) /
		86_400_000;
	return days > 1;
}
