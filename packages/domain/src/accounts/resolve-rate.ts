/**
 * The rate an account is stored with (WealthService.resolveExchangeRate and
 * the rules around it, moved here so the device reads the one copy): USD is
 * 1; a typed custom rate is used as typed; otherwise the best table rate for
 * the day, preferring the requested type; none at all is an error, never 1.
 */

import type { PickedRate } from "../money";
import { hasRate, MissingRateError, USD } from "../money-dec";
import { type DecimalInput, toFloat } from "../precise-decimal";
import { CUSTOM_RATE_TYPE } from "../rate-booking";
import { noRateFound } from "./refusals";

export interface AccountRate {
	readonly rate: number;
	readonly rateType: string | null;
}

/** No table rate and no usable typed rate: the server refuses in `noRateFound`'s words; a device cannot book it. */
export class NoRateFoundError extends Error {
	override readonly name = "NoRateFoundError";
	constructor(readonly currency: string) {
		super(noRateFound(currency));
	}
}

/** The best table rate of a currency on a day (windowed on the server and the device alike). */
export type FindAccountRate = (
	currency: string,
	date: Date,
	preferredType?: string | null,
) => PickedRate | null | Promise<PickedRate | null>;

export async function resolveAccountRate(
	currency: string,
	date: Date,
	requested: {
		readonly rate?: DecimalInput | null;
		readonly type?: string | null;
	},
	find: FindAccountRate,
): Promise<AccountRate> {
	if (currency === USD) return { rate: 1, rateType: null };
	const custom = requested.type === CUSTOM_RATE_TYPE ? requested.rate : null;
	if (custom != null && hasRate(currency, custom))
		return { rate: toFloat(custom), rateType: CUSTOM_RATE_TYPE };
	const best = await find(currency, date, requested.type);
	if (best) return { rate: best.rate, rateType: best.type };
	throw new NoRateFoundError(currency);
}

/** A USD account has no rate of its own; its rate type values the home side (D3), so it keeps the one asked for. */
export function usdKeepsRateType(
	currency: string,
	resolved: AccountRate,
	wanted: string | null | undefined,
): AccountRate {
	return currency === USD
		? { ...resolved, rateType: wanted ?? null }
		: resolved;
}

/**
 * Reopen's rate: today's rate of the account's type, else its stored rate;
 * none throws MissingRateError (a balance is never valued at 1). Any failure
 * to resolve falls to the stored rate, as the server always did.
 */
export async function reopenRate(
	resolve: () => Promise<AccountRate>,
	asset: {
		readonly currency: string;
		readonly exchangeRate: DecimalInput | null;
	},
): Promise<DecimalInput> {
	try {
		return (await resolve()).rate;
	} catch {
		if (
			asset.exchangeRate !== null &&
			hasRate(asset.currency, asset.exchangeRate)
		)
			return asset.exchangeRate;
		throw new MissingRateError(asset.currency);
	}
}
