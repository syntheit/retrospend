import type { WealthAccount } from "./types";

/**
 * The rate fields of an account write. An account saved in its own
 * currency with no new rate type picked keeps its stored valuation: the same
 * table type, or a custom rate as typed (without the rate the server would
 * look a table rate up and the account's value would change). A new type or
 * a new currency sends only the type picked.
 */
export function rateInput(
	account: WealthAccount | null,
	currency: string,
	picked: string | null,
): { exchangeRateType?: string; exchangeRate?: number } {
	const v = account?.valuation;
	const keep =
		v &&
		currency === account.amount.currency &&
		(picked == null || picked === v.type);
	if (!keep) return picked ? { exchangeRateType: picked } : {};
	return {
		...(v.type ? { exchangeRateType: v.type } : {}),
		// The exact decimal text of the stored rate, read as a number (a parse).
		...(v.customRate != null ? { exchangeRate: Number(v.customRate) } : {}),
	};
}
