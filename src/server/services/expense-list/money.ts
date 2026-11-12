/**
 * Server-side shaping for row DTOs: stored Decimals to Money in minor units,
 * home-currency values under the totals rule, and the category color token.
 * Clients only format what comes out of here (R9). The shaping is
 * @retrospend/domain/row-money, which a device runs too.
 */
export {
	categoryRef,
	decimalMoney,
	type HomeRates,
	homeFromUSD,
	homeDec,
	homeOf,
} from "@retrospend/domain/row-money";
