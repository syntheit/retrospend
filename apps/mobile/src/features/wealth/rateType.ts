import type { Account, CurrencyInfo } from "./source";

// Which rate type an account is valued at, and which ones it can be. The
// names people read ("Blue", "MEP") come from `useRateTypeLabel`
// (features/read/MoneyAmount), never the raw key. Rates themselves stay on
// the server: a type is a name here, and the server values the account.

/**
 * The rate types the server stores for a currency; none for the home
 * currency. "custom" needs a typed rate, which the phone does not take, so it
 * is not offered.
 */
export function rateTypesOf(
	catalog: readonly CurrencyInfo[],
	currency: string,
	home: string,
): string[] {
	if (currency === home) return [];
	return (catalog.find((c) => c.code === currency)?.rateTypes ?? []).filter(
		(type) => type !== "custom",
	);
}

/**
 * The type a foreign account's home value is read at ("Valued at Blue"), or
 * null when there is nothing to say: the account is in the home currency, has
 * no rate yet, or sits on the currency's default.
 */
export function valuedAt(account: Account): string | null {
	const foreign =
		account.value !== null &&
		account.value.currency !== account.balance.currency;
	return foreign ? account.rateType : null;
}

/** A pick that differs from the saved type: it values the account from today on. */
export function rateTypeChanged(
	saved: string | null,
	picked: string | null,
): boolean {
	return saved !== null && picked !== null && saved !== picked;
}
