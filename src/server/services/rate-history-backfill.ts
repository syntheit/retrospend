/**
 * Reading the rate source's own history, for scripts/backfill-rate-history.ts.
 * The sidecar syncs from one file, rates.json in the syntheit/exchange-rates
 * repository, which that repository's bot commits on every refresh. Each
 * commit is therefore a full snapshot, so the days before the app stored its
 * own history can be filled from the commits. These helpers mirror the
 * sidecar's parsing (sidecar/tasks/exchange_rates.go) so a backfilled day
 * reads like a synced one.
 */

export type RatesFile = {
	updatedAt: string;
	rates?: Record<string, number>;
	cryptoRates?: Record<string, number>;
};

export type HistoryDayRow = {
	/** ISO day (UTC) of the file's `updatedAt`. */
	day: string;
	currency: string;
	type: string;
	rate: number;
};

const VALID_CURRENCY = /^[A-Z]{3,10}$/;
const VALID_TYPE = /^[a-z0-9_-]{1,32}$/;

/** "ARS_BLUE" is ARS at blue; a bare code is official (the sidecar's rule). */
export function parseRateKey(key: string): { currency: string; type: string } {
	const parts = key.split("_");
	if (parts.length === 1) return { currency: key, type: "official" };
	return {
		currency: parts[0] ?? key,
		type: parts.slice(1).join("_").toLowerCase(),
	};
}

/**
 * One file's rates as history rows: fiat as quoted (units per USD), coins
 * as USD per coin at type "crypto" and only the coins the app supports.
 * A file with no readable `updatedAt` has no day and gives nothing.
 */
export function historyRowsOf(
	file: RatesFile,
	supportedCrypto: ReadonlySet<string>,
): HistoryDayRow[] {
	const updated = new Date(file.updatedAt);
	if (Number.isNaN(updated.getTime())) return [];
	const day = updated.toISOString().slice(0, 10);
	const rows: HistoryDayRow[] = [];
	for (const [key, rate] of Object.entries(file.rates ?? {})) {
		const parsed = parseRateKey(key);
		const currency = parsed.currency.toUpperCase();
		const type = parsed.type.toLowerCase();
		if (!VALID_CURRENCY.test(currency) || !VALID_TYPE.test(type)) continue;
		if (!Number.isFinite(rate) || rate <= 0) continue;
		rows.push({ day, currency, type, rate });
	}
	for (const [key, rate] of Object.entries(file.cryptoRates ?? {})) {
		const currency = key.toUpperCase();
		if (!VALID_CURRENCY.test(currency) || !supportedCrypto.has(currency))
			continue;
		if (!Number.isFinite(rate) || rate <= 0) continue;
		rows.push({ day, currency, type: "crypto", rate });
	}
	return rows;
}

export type CommitRef = { sha: string; date: string };

/** The last commit of each UTC day, newest day first. */
export function lastCommitPerDay(commits: readonly CommitRef[]): CommitRef[] {
	const byDay = new Map<string, CommitRef>();
	for (const c of commits) {
		const at = new Date(c.date);
		if (Number.isNaN(at.getTime())) continue;
		const day = at.toISOString().slice(0, 10);
		const kept = byDay.get(day);
		if (!kept || new Date(kept.date) < at) byDay.set(day, c);
	}
	return [...byDay.entries()]
		.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
		.map(([, c]) => c);
}
