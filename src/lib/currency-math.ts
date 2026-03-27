import { isCrypto } from "~/lib/currency-format";

export function toUSD(
	amount: number,
	currency: string,
	exchangeRate: number | undefined,
): number {
	if (!amount || amount === 0) return 0;
	if (currency === "USD") return amount;
	if (!exchangeRate || exchangeRate === 0) return 0;

	// RUBRIC: Crypto to USD = multiply, Fiat to USD = divide
	const usdValue = isCrypto(currency)
		? amount * exchangeRate
		: amount / exchangeRate;

	return Math.round(usdValue * 100) / 100;
}

export function fromUSD(
	usdAmount: number,
	targetCurrency: string,
	exchangeRate: number | undefined,
): number {
	if (!usdAmount || usdAmount === 0) return 0;
	if (targetCurrency === "USD") return usdAmount;
	if (!exchangeRate || exchangeRate === 0) return 0;

	// RUBRIC: USD to Crypto = divide, USD to Fiat = multiply
	const targetValue = isCrypto(targetCurrency)
		? usdAmount / exchangeRate
		: usdAmount * exchangeRate;

	return Math.round(targetValue * 100) / 100;
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

	// Convert to USD first
	let usdAmount: number;
	if (sourceCurrency === "USD") {
		usdAmount = amount;
	} else if (!sourceRate || sourceRate === 0) {
		return 0;
	} else {
		usdAmount = isCrypto(sourceCurrency)
			? amount * sourceRate
			: amount / sourceRate;
	}

	// Convert from USD to target
	if (targetCurrency === "USD") {
		return Math.round(usdAmount * 100) / 100;
	} else if (!targetRate || targetRate === 0) {
		return 0;
	} else {
		const targetValue = isCrypto(targetCurrency)
			? usdAmount / targetRate
			: usdAmount * targetRate;
		return Math.round(targetValue * 100) / 100;
	}
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
