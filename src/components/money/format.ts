/**
 * The one seam between the money components and the one formatter (R10,
 * IMPLEMENTATION §2.5). `formatMoney` lives in @retrospend/domain once
 * feature/s0b-formatter lands; until then this file holds its agreed
 * signature and refuses to format, so nothing can show a hand-made amount.
 * When it lands, this file re-exports the real one and the skipped golden
 * vector test in __tests__/money.test.ts is turned on.
 */

/** An amount in ISO minor units, as the server sends it (R9). */
export type MoneyValue = {
	minor: number | bigint;
	currency: string;
};

export type MoneyDisplay = "symbol" | "code";

/** auto: minus only; always: plus or minus; never: no sign (words carry it). */
export type MoneySign = "auto" | "always" | "never";

export type FormatMoneyOptions = {
	locale: string;
	display?: MoneyDisplay;
	sign?: MoneySign;
	/** auto follows the currency (whole ARS shows none); always or never force it. */
	cents?: "auto" | "always" | "never";
};

export function formatMoney(
	_money: MoneyValue,
	_options: FormatMoneyOptions,
): string {
	throw new Error(
		"formatMoney is not wired yet: it arrives with feature/s0b-formatter",
	);
}

/** Which way an amount points. A comparison, not money math. */
export function signOf(money: MoneyValue): -1 | 0 | 1 {
	const { minor } = money;
	if (typeof minor === "bigint") return minor > 0n ? 1 : minor < 0n ? -1 : 0;
	return minor > 0 ? 1 : minor < 0 ? -1 : 0;
}
