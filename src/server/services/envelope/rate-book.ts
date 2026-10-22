/**
 * Exchange rates for one engine pass, loaded in one query and kept as exact
 * decimal strings (valuation.ts never sees a float). A lookup takes the
 * latest rate on or before the date, else the earliest after it: the app's
 * nearest-rate rule (src/server/exchange-rates.ts). A currency or type with
 * no rows at all has no rate, and the row that needed it is left out.
 */
import { USD } from "~/lib/money";
import type { Prisma } from "~prisma";
import type { IsoDate } from "./types";
import type { UsdRateLookup } from "./valuation";

type Tx = Prisma.TransactionClient;

interface RatePoint {
	date: IsoDate;
	rate: string;
}

function pick(
	points: readonly RatePoint[] | undefined,
	date: IsoDate,
): string | null {
	if (!points || points.length === 0) return null;
	let lo = 0;
	let hi = points.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if ((points[mid] as RatePoint).date <= date) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return (points[Math.max(found, 0)] as RatePoint).rate;
}

export class RateBook {
	private constructor(private readonly points: Map<string, RatePoint[]>) {}

	/** Rows of the book currency (its rate types) and of `extraCurrencies` (every type), from `since` on (rows the engine reads start later). */
	static async load(
		tx: Tx,
		p: {
			bookCurrency: string;
			rateTypes: readonly string[];
			since: IsoDate;
			extraCurrencies?: readonly string[];
		},
	): Promise<RateBook> {
		const currencies = [
			...new Set([p.bookCurrency, ...(p.extraCurrencies ?? [])]),
		].filter((c) => c !== USD);
		const points = new Map<string, RatePoint[]>();
		if (currencies.length === 0) return new RateBook(points);
		const rows = await tx.exchangeRate.findMany({
			where: {
				currency: { in: currencies },
				date: { gte: new Date(`${p.since}T00:00:00Z`) },
			},
			orderBy: { date: "asc" },
			select: { currency: true, type: true, rate: true, date: true },
		});
		for (const r of rows) {
			if (r.currency === p.bookCurrency && !p.rateTypes.includes(r.type))
				continue;
			const key = `${r.currency}\0${r.type}`;
			const list = points.get(key) ?? [];
			list.push({
				date: r.date.toISOString().slice(0, 10),
				rate: r.rate.toString(),
			});
			points.set(key, list);
		}
		return new RateBook(points);
	}

	readonly lookup: UsdRateLookup = (currency, rateType, date) =>
		pick(this.points.get(`${currency}\0${rateType}`), date);
}
