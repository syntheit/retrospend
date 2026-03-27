/**
 * Converts a rate type key to a human-readable label.
 * @param type - The rate type (e.g., "official", "blue", "mep")
 * @returns A formatted display label
 */
export function getRateTypeLabel(type: string): string {
	const labels: Record<string, string> = {
		official: "Official",
		blue: "Blue (Informal)",
		mep: "MEP",
		crypto: "Crypto",
		tourist: "Tourist",
	};
	return labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

export interface GroupedExchangeRate {
	id: string;
	date: Date;
	currency: string;
	type: string;
	rate: number;
	isFavorite: boolean;
	createdAt: Date;
	updatedAt: Date;
	subRows?: GroupedExchangeRate[];
}

const RATE_TYPE_PRIORITY: Record<string, number> = {
	blue: 0,
	official: 1,
	mep: 2,
	crypto: 3,
	tourist: 4,
};

/**
 * Groups exchange rates by currency. For currencies with multiple rate types
 * (e.g. ARS has blue/official/mep/crypto), picks the preferred rate as the
 * parent row and puts the rest into `subRows`.
 */
export function groupRatesByCurrency<
	T extends {
		id: string;
		currency: string;
		type: string;
		rate: number;
		isFavorite?: boolean;
	},
>(rates: T[]): (T & { subRows?: T[] })[] {
	const groups = new Map<string, T[]>();

	for (const rate of rates) {
		const existing = groups.get(rate.currency);
		if (existing) {
			existing.push(rate);
		} else {
			groups.set(rate.currency, [rate]);
		}
	}

	const result: (T & { subRows?: T[] })[] = [];

	for (const [, currencyRates] of groups) {
		if (currencyRates.length === 1) {
			result.push(currencyRates[0]!);
			continue;
		}

		// Sort by priority: blue > official > mep > crypto > tourist > rest
		const sorted = [...currencyRates].sort(
			(a, b) =>
				(RATE_TYPE_PRIORITY[a.type] ?? 99) -
				(RATE_TYPE_PRIORITY[b.type] ?? 99),
		);

		const parent = sorted[0]!;
		const subRows = sorted.slice(1);
		result.push({ ...parent, subRows });
	}

	return result;
}
