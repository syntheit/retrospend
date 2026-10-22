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
 *   every locale so a row of amounts lines up.
 *
 * Golden cases: packages/domain/vectors/money-format.vectors.json.
 */
import { isCrypto, SMART_NO_DECIMAL_CURRENCIES } from "./currency-format";
import {
	compactAffix,
	groupDigits,
	type NumberSymbols,
	numberSymbols,
} from "./format-locale";
import { currencyDecimals } from "./money";
import { money as checkedMoney, type Money } from "./money-minor";

/** "none" leaves the currency out: a chart axis whose title names it. */
export type MoneyDisplay = "symbol" | "code" | "none";
/** auto: minus for negatives. exceptZero: plus for positives too. never: size only. */
export type MoneySign = "auto" | "exceptZero" | "never";

export interface FormatMoneyOptions {
	locale: string;
	/** "symbol" is honored only for an unambiguous symbol. Default "code". */
	display?: MoneyDisplay;
	/** Default "auto". */
	sign?: MoneySign;
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

function unitLabel(
	code: string,
	display: MoneyDisplay,
	locale: string,
): string {
	const symbol = display === "symbol" ? UNAMBIGUOUS_SYMBOLS[code] : undefined;
	if (display === "none") return "";
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
	const { locale, display = "code", sign = "auto", cents = "auto" } = options;
	const abs = Math.abs(minor);
	const decimals = currencyDecimals(currency);
	if (options.compact) {
		const c = compactNumber(abs, decimals, locale, numberSymbols(locale));
		return (
			signFor(minor, c.rounded, sign) +
			unitLabel(currency, display, locale) +
			c.text
		);
	}
	const { shown, trim } = shownDecimals(abs, currency, decimals, cents);
	const rounded = roundHalfEven(abs, decimals - shown);

	const digits = String(rounded).padStart(shown + 1, "0");
	const cut = digits.length - shown;
	let fraction = digits.slice(cut);
	if (trim) fraction = fraction.replace(/0+$/, "");
	const symbols = numberSymbols(locale);
	const number =
		groupDigits(digits.slice(0, cut), symbols) +
		(fraction ? symbols.decimal + fraction : "");

	return (
		signFor(minor, rounded, sign) +
		unitLabel(currency, display, locale) +
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
		original: formatMoney(original, { ...options, display: "code" }),
		home: formatMoney(home, options),
	};
}
