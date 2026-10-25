import { parseRateText, rateToText } from "~/features/entry/rate-text";
import type { WealthAccount } from "./types";

/**
 * The rate fields of an account write. An account saved in its own
 * currency with no new rate type picked keeps its stored valuation: the same
 * table type, or a custom rate as typed (without the rate the server would
 * look a table rate up and the account's value would change). A new type or
 * a new currency sends only the type picked.
 *
 * A rate travels as decimal text, like every typed rate, so no digit goes
 * through a float on the way to the server.
 */
export function rateInput(
	account: WealthAccount | null,
	currency: string,
	picked: string | null,
): { exchangeRateType?: string; exchangeRate?: string } {
	const v = account?.valuation;
	const keep =
		v &&
		currency === account.amount.currency &&
		(picked == null || picked === v.type);
	if (!keep) return picked ? { exchangeRateType: picked } : {};
	return {
		...(v.type ? { exchangeRateType: v.type } : {}),
		// The stored rate's own digits (the column keeps 6 decimals), without
		// trailing zeros. One the reader refuses goes as stored: the server's
		// schema then says so, instead of a table rate replacing it.
		...(v.customRate != null
			? { exchangeRate: parseRateText(v.customRate, "en-US") ?? v.customRate }
			: {}),
	};
}

/**
 * The legacy account dialog's rate, as decimal text for the column
 * (DECIMAL(18,6)). Only a custom rate is read by the server; a table type is
 * looked up again, so nothing is sent for it.
 */
export function customAccountRate(
	type: string | undefined,
	rate: number | undefined,
): string | undefined {
	return type === "custom" ? (rateToText(rate, 6) ?? undefined) : undefined;
}
