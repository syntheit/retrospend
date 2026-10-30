import { useSession } from "@/auth/session";
import type { CurrencyChoice } from "@/ui/AmountField";
import { useEntryCatalog } from "./hooks";
import type { EntryCatalog } from "./types";

/** What every money field offers for its currency: the same lists from one place. */
export type CurrencyChoices = Omit<CurrencyChoice, "onChange">;

/**
 * The currencies to choose from, the person's own (home, then default) and the
 * ones used lately. `fallback` stands in until the catalog is in, so the
 * current currency is always choosable.
 */
export function currencyChoices(
	catalog: Pick<EntryCatalog, "currencies" | "recentCurrencies"> | null,
	me: { homeCurrency?: string | null; defaultCurrency?: string | null } | null,
	fallback: string,
): CurrencyChoices {
	return {
		currencies: catalog?.currencies ?? [fallback],
		yours: [me?.homeCurrency, me?.defaultCurrency].filter((c): c is string =>
			Boolean(c),
		),
		recent: catalog?.recentCurrencies ?? [],
	};
}

/** `currencyChoices` for a sheet that has no entry form: the catalog and the profile are read here. */
export function useCurrencyChoices(fallback: string): CurrencyChoices {
	const { state } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const catalog = useEntryCatalog();
	return currencyChoices(
		catalog.status === "ready" ? catalog.catalog : null,
		me,
		fallback,
	);
}
