import { isCrypto } from "~/lib/currency-format";
import {
	isValidRate,
	fromUSD as moneyFromUSD,
	roundMoney,
	roundUSD,
	toUSD as moneyToUSD,
} from "~/lib/money";

// Legacy client helpers. Formulas come from ~/lib/money (which documents the
// rate convention); these keep their old contract of returning 0 for a
// missing rate. Results are rounded to the target currency's decimals
// (2 for USD, 0 for JPY, 8 for BTC).

export function toUSD(
	amount: number,
	currency: string,
	exchangeRate: number | undefined,
): number {
	if (!amount || amount === 0) return 0;
	if (currency === "USD") return amount;
	if (!isValidRate(exchangeRate)) return 0;
	return roundUSD(moneyToUSD(amount, currency, exchangeRate));
}

export function fromUSD(
	usdAmount: number,
	targetCurrency: string,
	exchangeRate: number | undefined,
): number {
	if (!usdAmount || usdAmount === 0) return 0;
	if (targetCurrency === "USD") return usdAmount;
	if (!isValidRate(exchangeRate)) return 0;
	return roundMoney(
		moneyFromUSD(usdAmount, targetCurrency, exchangeRate),
		targetCurrency,
	);
}

export function convert(
	amount: number,
	sourceCurrency: string,
	sourceRate: number | undefined,
	targetCurrency: string,
	targetRate: number | undefined,
): number {
	if (!amount || amount === 0) return 0;
	if (sourceCurrency === targetCurrency) return amount;

	if (sourceCurrency !== "USD" && !isValidRate(sourceRate)) return 0;
	const usdAmount = moneyToUSD(amount, sourceCurrency, sourceRate);

	if (targetCurrency === "USD") return roundUSD(usdAmount);
	if (!isValidRate(targetRate)) return 0;
	return roundMoney(
		moneyFromUSD(usdAmount, targetCurrency, targetRate),
		targetCurrency,
	);
}

export function getDisplayRate(
	exchangeRate: number | undefined,
	currency: string,
	displayMode: "foreign-to-usd" | "usd-to-foreign" = "usd-to-foreign",
): number {
	if (!exchangeRate || exchangeRate === 0) return 0;
	if (currency === "USD") return 1;

	// Crypto rates are always stored as USD per unit, so they display the same way
	if (isCrypto(currency)) {
		return exchangeRate;
	}

	// Fiat rates are stored as Units per USD
	// - "usd-to-foreign": 1 USD = X FOREIGN (raw rate)
	// - "foreign-to-usd": 1 FOREIGN = X USD (inverted)
	return displayMode === "foreign-to-usd" ? 1 / exchangeRate : exchangeRate;
}
