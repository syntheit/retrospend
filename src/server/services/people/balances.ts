/**
 * Pure pieces of the People reads: one person's balance parts and net in
 * the home currency (the same rule as owed.owedToYou, payments/owed.ts),
 * which group a person sits in, and the balance bar's segment sizes. No I/O;
 * money is integer minor units and Decimal rates, never a float.
 */
import { ratioBp, sumMinor, toMinor } from "~/server/services/envelope/units";
import { toPaymentCurrency } from "~/server/services/payments/allocate";
import type { Minor, Quote } from "~/server/services/payments/types";
import type {
	BalancePart,
	BarSegment,
	PeopleGroup,
	PersonKey,
	RateDTO,
} from "./types";

const money = (minor: Minor, currency: string) => ({ minor, currency });

/** 1 unit of `currency` in `home` at `quote`, as two Money amounts the client formats. */
export function rateOf(
	currency: string,
	home: string,
	quote: Quote | undefined,
): RateDTO | null {
	if (!quote) return null;
	return {
		type: quote.rateType,
		unit: money(toMinor("1", currency), currency),
		value: money(toMinor(quote.perUnit, home), home),
	};
}

/**
 * A balance per currency (positive = they owe you) as parts with their home
 * values, home currency first, then by code. A part without a quote keeps
 * home null: it is shown, never counted.
 */
export function balanceParts(
	overall: ReadonlyMap<string, Minor>,
	home: string,
	quotes: ReadonlyMap<string, Quote>,
): BalancePart[] {
	return [...overall]
		.filter(([, minor]) => minor !== 0)
		.sort(([a], [b]) =>
			a === home ? -1 : b === home ? 1 : a < b ? -1 : a > b ? 1 : 0,
		)
		.map(([currency, minor]) => {
			if (currency === home)
				return {
					amount: money(minor, currency),
					home: money(minor, home),
					rate: null,
				};
			const quote = quotes.get(currency);
			return {
				amount: money(minor, currency),
				home: quote
					? money(toPaymentCurrency(minor, currency, home, quote), home)
					: null,
				rate: rateOf(currency, home, quote),
			};
		});
}

/** The net of the parts in the home currency, or null when one has no rate. */
export function netOf(
	parts: readonly BalancePart[],
	home: string,
): { minor: Minor; currency: string } | null {
	if (parts.some((p) => p.home === null)) return null;
	return money(sumMinor(parts.map((p) => p.home?.minor ?? 0)), home);
}

/**
 * Owe you or You owe follows the net. Without a net (a currency has no
 * rate) a person who owes you anything sits under Owe you; nobody's parts
 * are netted by hand. No balance: Pending while a payment waits, else Settled.
 */
export function groupOf(
	parts: readonly BalancePart[],
	net: { minor: Minor } | null,
	hasPending: boolean,
): PeopleGroup {
	if (parts.length > 0) {
		if (net) return net.minor >= 0 ? "owed" : "owe";
		return parts.some((p) => p.amount.minor > 0) ? "owed" : "owe";
	}
	return hasPending ? "pending" : "settled";
}

/**
 * The balance bar: each person with a net, sized by their share of Owed to
 * you plus You owe (hundredths of a percent, at least 1 so nobody vanishes),
 * largest first on each side. People without a net are left out: the page
 * names their currency as not in the total.
 */
export function barSegments(
	people: readonly {
		key: PersonKey;
		net: { minor: Minor; currency: string } | null;
	}[],
	owedToYou: Minor,
	youOwe: Minor,
): BarSegment[] {
	const total = owedToYou + youOwe;
	if (total <= 0) return [];
	const segments = people.flatMap((p): BarSegment[] => {
		if (!p.net || p.net.minor === 0) return [];
		const size = Math.abs(p.net.minor);
		return [
			{
				key: p.key,
				direction: p.net.minor > 0 ? "owed" : "owe",
				share: Math.max(1, ratioBp(size, total) ?? 0),
				amount: money(size, p.net.currency),
			},
		];
	});
	const side = (d: BarSegment["direction"]) =>
		segments
			.filter((s) => s.direction === d)
			.sort((a, b) => b.amount.minor - a.amount.minor);
	return [...side("owed"), ...side("owe")];
}

/** Currencies with a balance but no rate, once each. */
export function unpricedOf(parts: readonly BalancePart[][]): string[] {
	const out = new Set<string>();
	for (const list of parts)
		for (const p of list) if (p.home === null) out.add(p.amount.currency);
	return [...out].sort();
}
