/**
 * The booked home value of one leg (I20): what `amount` of a place is worth
 * at home on a day. Moved here from the server's ledger so the checkpoint,
 * the transfer rows and the device engine read one copy.
 */
import { Dec, type Decimal } from "../precise-decimal";
import { homeValue, type RatePick } from "./valuation";

/** The fields that value an account (its currency, rate type and stored rate). */
export interface Valuable {
	readonly currency: string;
	readonly exchangeRateType: string | null;
	readonly exchangeRate: { toString(): string } | number | null;
}

const endOfDayOf = (date: Date) =>
	new Date(`${date.toISOString().slice(0, 10)}T23:59:59.999Z`);

/** What `amount` of a place is worth at home on `date`: an account at its own rate type, Not tracked at the default pick. */
export function bookHome(
	pick: RatePick,
	place: { currency: string; account: Valuable | null },
	amount: Decimal,
	homeCurrency: string,
	date: Date,
): { amount: Decimal; currency: string } | null {
	const valued = place.account
		? {
				currency: place.account.currency,
				rateType: place.account.exchangeRateType,
				storedRate: place.account.exchangeRate,
			}
		: { currency: place.currency, rateType: null, storedRate: null };
	const value = homeValue(pick, valued, amount, homeCurrency, endOfDayOf(date));
	// 8 decimals; an exact tie rounds half to even.
	return (
		value && {
			amount: value.toDecimalPlaces(8, Dec.ROUND_HALF_EVEN),
			currency: homeCurrency,
		}
	);
}
