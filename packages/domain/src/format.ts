/**
 * The one money formatter (PLAN R10). Every client formats server-computed
 * Money through formatMoney; nothing else builds a money string.
 *
 * - The currency leads: "USD 1,234.56", "-ARS 2,000", "€1,234.50". A code
 *   shows unless the caller asks for a symbol and the symbol is unambiguous;
 *   every "$" currency, "¥" and crypto show their code.
 * - Digits come from integer minor units by string arithmetic, so there is
 *   no float rounding. Rounding happens only when fewer digits are shown
 *   than the currency has (crypto significant digits, cents: false), and
 *   then it is half to even.
 * - The locale picks separators and grouping only; placement is the same in
 *   every locale so a row of amounts lines up. The account's number format
 *   setting rides on the locale tag (withNumberFormat in ./format-locale).
 *
 * Golden cases: packages/domain/vectors/money-format.vectors.json.
 */
import { CURRENCIES } from "./currencies";
import {
	getCurrencySymbolWithPreference,
	isCrypto,
	SMART_NO_DECIMAL_CURRENCIES,
} from "./currency-format";
import {
	compactAffix,
	groupDigits,
	homeCurrencyOf,
	type NumberFormatChoice,
	type NumberSymbols,
	numberSymbols,
	withNumberFormat,
} from "./format-locale";
import { currencyDecimals } from "./money";
import { money as checkedMoney, type Money } from "./money-minor";

/** "none" leaves the currency out: a chart axis whose title names it. */
export type MoneyDisplay = "symbol" | "code" | "none";
/** auto: minus for negatives. exceptZero: plus for positives too. never: size only. */
export type MoneySign = "auto" | "exceptZero" | "never";

export interface FormatMoneyOptions {
	locale: string;
	/**
	 * "symbol" is honored only for an unambiguous symbol. Default: the home
	 * currency (the locale's "-x-hc-" tag) shows its narrow symbol and every
	 * other currency its code, so a "$" always means home. "code" forces the
	 * code, "none" leaves the currency out.
	 */
	display?: MoneyDisplay;
	/** Default "auto". */
	sign?: MoneySign;
	/**
	 * The account's currency symbol style. With display "symbol" it picks the
	 * symbol the way the legacy formatter does (standard "AR$", native "$"),
	 * so the same amount reads the same on every client. Omitted: only
	 * unambiguous symbols show.
	 */
	symbolStyle?: "native" | "standard";
	/**
	 * auto (default): the currency's minor digits; high-nominal currencies
	 * (ARS, COP...) drop ".00" on whole amounts; crypto shows up to 8
	 * significant digits without trailing zeros. true: every minor digit.
	 * false: whole units, rounded half to even.
	 */
	cents?: boolean | "auto";
	/**
	 * Short scale for chart axes: "2.7M", "850K" (the locale's own suffix:
	 * "2,7 M", "850 mil"), one fraction digit at most, rounded half to even
	 * from minor units. Under 1,000 whole units it is the whole amount.
	 */
	compact?: boolean;
	/**
	 * A rate, not an amount: how many decimal digits `minor` carries when that
	 * is more than the currency's own (USD 0.00064 is 64 at 5 places). Fiat
	 * shows the digits down to the currency's own, dropping trailing zeros
	 * beyond them. Ignored when it is not more than the currency has.
	 */
	places?: number;
}

/** Symbols no other currency uses. "$", "¥", "kr" and the like are not here. */
const UNAMBIGUOUS_SYMBOLS: Readonly<Record<string, string>> = {
	EUR: "€",
	GBP: "£",
	BRL: "R$",
	INR: "₹",
	RUB: "₽",
	UAH: "₴",
	TRY: "₺",
	ILS: "₪",
};

/** Currencies whose whole amounts hide ".00" (the smart-formatting list, plus UYU from the mockups). */
const WHOLE_BY_DEFAULT = new Set<string>([
	...SMART_NO_DECIMAL_CURRENCIES,
	"UYU",
]);

const CRYPTO_SIGNIFICANT_DIGITS = 8;
const NBSP = " ";

/** |minor| rounded half to even to drop its last `drop` digits. */
function roundHalfEven(abs: number, drop: number): number {
	if (drop <= 0) return abs;
	const unit = 10 ** drop;
	const rest = abs % unit;
	const kept = (abs - rest) / unit;
	const twice = rest * 2;
	return twice > unit || (twice === unit && kept % 2 === 1) ? kept + 1 : kept;
}

/** How many fraction digits to show, and whether trailing zeros go. */
function shownDecimals(
	abs: number,
	code: string,
	decimals: number,
	cents: boolean | "auto",
): { shown: number; trim: boolean } {
	if (cents === false) return { shown: 0, trim: false };
	if (cents === true) return { shown: decimals, trim: false };
	const unit = 10 ** decimals;
	if (isCrypto(code)) {
		const whole = (abs - (abs % unit)) / unit;
		const intDigits = whole === 0 ? 0 : String(whole).length;
		const room = CRYPTO_SIGNIFICANT_DIGITS - intDigits;
		return { shown: Math.max(0, Math.min(decimals, room)), trim: true };
	}
	if (WHOLE_BY_DEFAULT.has(code) && abs % unit === 0) {
		return { shown: 0, trim: false };
	}
	return { shown: decimals, trim: false };
}

/** How many currencies write `symbol` as their standard or native symbol. */
let symbolUse: Map<string, number> | null = null;
function symbolUsers(symbol: string): number {
	if (!symbolUse) {
		symbolUse = new Map();
		for (const c of Object.values(CURRENCIES)) {
			for (const s of new Set([c.symbol, c.symbol_native])) {
				symbolUse.set(s, (symbolUse.get(s) ?? 0) + 1);
			}
		}
	}
	return symbolUse.get(symbol) ?? 0;
}

/**
 * The symbol to show, or undefined when the code shows instead. With the
 * account's style the symbol is that style's, but only when no other
 * currency uses it: "$" is every dollar and peso, so those keep their code.
 */
function symbolFor(
	code: string,
	display: MoneyDisplay,
	style: "native" | "standard" | undefined,
): string | undefined {
	if (display !== "symbol") return undefined;
	if (!style) return UNAMBIGUOUS_SYMBOLS[code];
	// Crypto and unknown tickers have no symbol: their code stands.
	if (!(code in CURRENCIES)) return undefined;
	const symbol = getCurrencySymbolWithPreference(code, style);
	return symbolUsers(symbol) === 1 ? symbol : undefined;
}

/**
 * The narrow symbol of the currencies people keep a home account in. A fixed
 * table, not Intl: engines disagree (Hermes answers "ARS" or "US$"), and the
 * same amount must read the same on every client. Every other currency has
 * no narrow symbol here, so its code stands. A test checks each entry
 * against CLDR (Intl "narrowSymbol").
 */
export const NARROW_SYMBOLS: Readonly<Record<string, string>> = {
	USD: "$",
	CAD: "$",
	AUD: "$",
	NZD: "$",
	MXN: "$",
	ARS: "$",
	CLP: "$",
	COP: "$",
	UYU: "$",
	SGD: "$",
	HKD: "$",
	TWD: "$",
	EUR: "\u20ac",
	GBP: "\u00a3",
	JPY: "\u00a5",
	CNY: "\u00a5",
	BRL: "R$",
	INR: "\u20b9",
	KRW: "\u20a9",
	RUB: "\u20bd",
	TRY: "\u20ba",
	UAH: "\u20b4",
	ILS: "\u20aa",
	PHP: "\u20b1",
	VND: "\u20ab",
	THB: "\u0e3f",
	NGN: "\u20a6",
	PLN: "z\u0142",
	CZK: "K\u010d",
	HUF: "Ft",
	SEK: "kr",
	NOK: "kr",
	DKK: "kr",
	ZAR: "R",
};

function unitLabel(
	code: string,
	display: MoneyDisplay | undefined,
	locale: string,
	style?: "native" | "standard",
): string {
	if (display === "none") return "";
	// No display asked for: the home currency (the locale's "-x-hc-" tag) is
	// the one amount with a symbol, so a "$" always means home.
	const symbol =
		display === undefined
			? code === homeCurrencyOf(locale)
				? NARROW_SYMBOLS[code]
				: undefined
			: symbolFor(code, display, style);
	if (!symbol) return code + NBSP;
	return numberSymbols(locale).symbolSpaced ? symbol + NBSP : symbol;
}

/** |minor| with `drop` digits rounded away (half to even), or scaled up when negative. */
function tenthsOf(abs: number, drop: number): number {
	return drop < 0 ? abs * 10 ** -drop : roundHalfEven(abs, drop);
}

/** Compact magnitudes, largest first: trillion, billion, million, thousand. */
const COMPACT_EXPONENTS = [12, 9, 6, 3];

/**
 * |minor| on the short scale: tenths of the largest magnitude it reaches,
 * rounded half to even. Returns the text and the rounded size, so the sign
 * can tell a value that rounds to zero.
 */
function compactNumber(
	abs: number,
	decimals: number,
	locale: string,
	symbols: NumberSymbols,
): { text: string; rounded: number } {
	for (const exp of COMPACT_EXPONENTS) {
		const affix = compactAffix(locale, exp);
		// Reached when it shows as 1,000.0 or more of the next smaller step,
		// so 999,960 reads "1M" rather than "1,000K".
		if (!affix || tenthsOf(abs, decimals + exp - 4) < 10_000) continue;
		const tenths = roundHalfEven(abs, decimals + exp - 1);
		const tenth = tenths % 10;
		const whole = (tenths - tenth) / 10;
		const digits = groupDigits(String(whole), symbols);
		const number = tenth ? digits + symbols.decimal + tenth : digits;
		return { text: number + affix.gap + affix.suffix, rounded: tenths };
	}
	const rounded = roundHalfEven(abs, decimals);
	return { text: groupDigits(String(rounded), symbols), rounded };
}

/**
 * Formats Money for display. Returns null for missing money (no rate yet,
 * unavailable), so the caller shows its own words. Throws RangeError for
 * money that is not a safe integer or has no currency.
 */
export function formatMoney(value: Money, options: FormatMoneyOptions): string;
export function formatMoney(
	value: Money | null | undefined,
	options: FormatMoneyOptions,
): string | null;
export function formatMoney(
	value: Money | null | undefined,
	options: FormatMoneyOptions,
): string | null {
	if (value == null) return null;
	const { minor, currency } = checkedMoney(value.minor, value.currency);
	const {
		locale,
		display,
		sign = "auto",
		cents = "auto",
		symbolStyle,
	} = options;
	const abs = Math.abs(minor);
	const own = currencyDecimals(currency);
	const decimals = Math.max(own, options.places ?? 0);
	if (options.compact) {
		const c = compactNumber(abs, decimals, locale, numberSymbols(locale));
		return (
			signFor(minor, c.rounded, sign) +
			unitLabel(currency, display, locale, symbolStyle) +
			c.text
		);
	}
	const { shown, trim } = shownDecimals(abs, currency, decimals, cents);
	const rounded = roundHalfEven(abs, decimals - shown);

	const digits = String(rounded).padStart(shown + 1, "0");
	const cut = digits.length - shown;
	let fraction = digits.slice(cut);
	if (trim) fraction = fraction.replace(/0+$/, "");
	else if (decimals > own && cents === "auto")
		fraction = fraction.replace(/0+$/, "").padEnd(own, "0");
	const symbols = numberSymbols(locale);
	const number =
		groupDigits(digits.slice(0, cut), symbols) +
		(fraction ? symbols.decimal + fraction : "");

	return (
		signFor(minor, rounded, sign) +
		unitLabel(currency, display, locale, symbolStyle) +
		number
	);
}

/** Leading minus, or a plus under exceptZero; nothing for what shows as zero. */
function signFor(minor: number, rounded: number, sign: MoneySign): string {
	if (rounded === 0 || sign === "never") return "";
	if (minor < 0) return "-";
	return sign === "exceptZero" ? "+" : "";
}

export interface FormattedMoneyPair {
	/** The amount as entered. Shown first. */
	original: string;
	/** The home-currency amount, shown second and muted; null when it adds nothing or is missing. */
	home: string | null;
}

/**
 * A foreign amount and its home value: original first, then home. The
 * original shows its code whenever it is (or may be) foreign; only the home
 * amount uses `display`. Same currency: one amount, home is null. Missing
 * home (no rate yet): home is null and the caller says why.
 */
export function formatMoneyPair(
	original: Money,
	home: Money | null | undefined,
	options: FormatMoneyOptions,
): FormattedMoneyPair {
	const same =
		home != null &&
		home.currency.toUpperCase() === original.currency.toUpperCase();
	if (same) return { original: formatMoney(original, options), home: null };
	return {
		original: formatMoney(original, {
			...options,
			// A foreign original keeps its code; the home currency keeps its symbol.
			display:
				original.currency.toUpperCase() === homeCurrencyOf(options.locale)
					? options.display
					: "code",
		}),
		home: formatMoney(home, options),
	};
}

/** The settings choices for how digits are marked: the language's own, or one of three. */
export type NumberFormatOption = "follow" | NumberFormatChoice;

/** 1,234,567.89 as minor units at `places` decimals, rounded half up. */
function sampleMinor(places: number): number {
	const whole = 123_456_789;
	if (places >= 2) return whole * 10 ** (places - 2);
	const unit = 10 ** (2 - places);
	const kept = Math.floor(whole / unit);
	return whole % unit >= unit / 2 ? kept + 1 : kept;
}

/**
 * Each number format option as the user's own amount would read in it, for
 * the Settings picker: 1,234,567.89 in `currency` (at its own places, so a
 * yen shows no decimals) in the language `locale`. "follow" is the language
 * alone; the other three keep its pattern and swap the marks.
 */
export function numberFormatExamples(
	currency: string,
	locale: string,
): Record<NumberFormatOption, string> {
	const sample = checkedMoney(
		sampleMinor(currencyDecimals(currency)),
		currency,
	);
	const show = (choice: NumberFormatChoice | null) =>
		formatMoney(sample, {
			locale: withNumberFormat(locale, choice),
			cents: true,
		});
	return {
		follow: show(null),
		comma_dot: show("comma_dot"),
		dot_comma: show("dot_comma"),
		space_comma: show("space_comma"),
	};
}
