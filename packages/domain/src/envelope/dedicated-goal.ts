/**
 * Savings goals linked to a Wealth account marked "Only for this goal"
 * (SPEC §5.4, B12, B13): their progress is the envelope's Left plus that
 * account's value today in the book currency, instead of Left plus what was
 * moved to Wealth. Display and target sizing only, like a foreign target
 * (D25). An account in another currency without a rate today leaves the
 * target incomplete, never valued at 1 (R14).
 */
import { worthOf } from "../accounts/places";
import type { BookRowCore, DedicatedAccount } from "./book-source";
import type { IsoDate, Minor, MissingRate, MonthKey } from "./types";
import { convertToBook, type ValuationContext } from "./valuation";

/** Each dedicated goal's account value today in H; null and a missing rate when it has none. */
export function dedicatedValues(
	row: Pick<BookRowCore, "envelopes">,
	accounts: readonly DedicatedAccount[],
	at: { today: IsoDate; month: MonthKey; valuation: ValuationContext },
	missingRates: MissingRate[],
): Map<string, Minor | null> {
	const byId = new Map(accounts.map((a) => [a.id, a]));
	const out = new Map<string, Minor | null>();
	for (const e of row.envelopes) {
		const a =
			e.wealthDedicated && e.wealthAccountId
				? byId.get(e.wealthAccountId)
				: null;
		if (!a || e.kind !== "SAVINGS") continue;
		const v = convertToBook(
			worthOf(a.type, a.balance).toString(),
			a.currency,
			{
				date: at.today,
				month: at.month,
				foreignRateType: a.exchangeRateType ?? "official",
			},
			at.valuation,
		);
		if (!v.ok) missingRates.push(v.missing);
		out.set(e.id, v.ok ? v.minor : null);
	}
	return out;
}
