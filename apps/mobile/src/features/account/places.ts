import { CURRENCIES_APART, RECURRING_APART } from "@/layout/destinations";

/**
 * Where Currencies opens: its own sidebar destination on the iPad, a screen
 * pushed from Settings on phones. Home's Dollar today and the account sheet
 * share it.
 */
export function currenciesHref(): "/currencies" | "/settings/currencies" {
	return CURRENCIES_APART ? "/currencies" : "/settings/currencies";
}

/** Where Recurring expenses open, the same way. */
export function recurringHref(): "/recurring" | "/settings/recurring" {
	return RECURRING_APART ? "/recurring" : "/settings/recurring";
}
