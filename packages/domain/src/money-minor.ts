/**
 * Money as integer minor units: the one DTO shape every client and the
 * server exchange ({ minor, currency }). Minor units follow currencyDecimals
 * (ISO 4217 for fiat, 8 for crypto, 2 for stablecoins), so 1234 USD minor is
 * 12.34 and 400000 ETH minor is 0.004. Integers keep sums exact; a safe
 * integer covers BTC 21M (2.1e15 satoshis) and ARS 1e12 (1e14 cents).
 */
import { isPrismaDecimal, type PrismaDecimal } from "./decimal";
import { currencyDecimals } from "./money";

export interface Money {
	/** Integer minor units, within Number.MAX_SAFE_INTEGER. */
	readonly minor: number;
	/** Upper-case currency code (ISO 4217 or a crypto ticker). */
	readonly currency: string;
}

/** Thrown when money in two currencies is added or compared as one. */
export class CurrencyMismatchError extends Error {
	constructor(
		public readonly left: string,
		public readonly right: string,
	) {
		super(`Cannot combine ${left} and ${right} amounts`);
		this.name = "CurrencyMismatchError";
	}
}

function assertSafeMinor(minor: number): number {
	if (!Number.isSafeInteger(minor)) {
		throw new RangeError(`Minor units must be a safe integer, got ${minor}`);
	}
	// -0 would otherwise survive into "-USD 0.00" checks and JSON.
	return minor === 0 ? 0 : minor;
}

/** A validated Money: safe-integer minor units and an upper-case code. */
export function money(minor: number, currency: string): Money {
	if (typeof currency !== "string" || currency.trim() === "") {
		throw new RangeError("Money needs a currency code");
	}
	return {
		minor: assertSafeMinor(minor),
		currency: currency.trim().toUpperCase(),
	};
}

/**
 * Minor units for an amount in major units.
 *
 * A number is scaled with float noise trimmed (1.005 * 100 is
 * 100.49999999999999 as a float, read as 100.5), then rounded half to even
 * on its magnitude, so 1.005 and -1.005 USD give 100 and -100. A number at
 * or above 1e15 minor units is refused: a float cannot hold that many digits
 * (12345678.12345678 BTC reads back as ...680 satoshis). Pass a string or a
 * Prisma Decimal instead; those are read exactly, and refused when they are
 * more precise than the currency, since a stored amount should never need
 * rounding.
 */
export function toMinor(
	amount: number | string | PrismaDecimal,
	currency: string,
): number {
	if (typeof amount === "number") return numberToMinor(amount, currency);
	const text = isPrismaDecimal(amount) ? amount.toString() : amount;
	return decimalTextToMinor(text, currencyDecimals(currency));
}

/** Where 15 significant digits, all a float reliably keeps, run out. */
const FLOAT_DIGITS_LIMIT = 1e15;

function numberToMinor(amount: number, currency: string): number {
	if (!Number.isFinite(amount)) {
		throw new RangeError(`Amount must be finite, got ${amount}`);
	}
	const factor = 10 ** currencyDecimals(currency);
	const scaled = Number((Math.abs(amount) * factor).toPrecision(15));
	if (scaled >= FLOAT_DIGITS_LIMIT) {
		throw new RangeError(
			`${amount} ${currency} has more digits than a float keeps; pass it as a string`,
		);
	}
	const whole = Math.floor(scaled);
	const rest = scaled - whole;
	const rounded =
		rest > 0.5 || (rest === 0.5 && whole % 2 === 1) ? whole + 1 : whole;
	return amount < 0 && rounded !== 0 ? -rounded : rounded;
}

const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

/** "12.34" at 2 decimals -> 1234; accepts the exponent form Decimal can print. */
function decimalTextToMinor(text: string, decimals: number): number {
	const match = DECIMAL_TEXT.exec(text.trim());
	const whole = match?.[2] ?? "";
	const digits = whole + (match?.[3] ?? "");
	if (!match || digits === "") {
		throw new RangeError(`Not a decimal amount: "${text}"`);
	}
	// Index in `digits` where the point falls once scaled to minor units.
	const point = whole.length + Number(match[4] ?? 0) + decimals;
	if (point - digits.replace(/^0+/, "").length > 30) {
		throw new RangeError(`Amount out of range: "${text}"`);
	}
	const kept = point <= 0 ? "" : digits.slice(0, point).padEnd(point, "0");
	const dropped = point <= 0 ? digits : digits.slice(point);
	if (/[1-9]/.test(dropped)) {
		throw new RangeError(
			`"${text}" is more precise than ${decimals} decimal places`,
		);
	}
	const big = BigInt(kept === "" ? "0" : kept);
	if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`Amount out of range: "${text}"`);
	}
	const minor = Number(big);
	return match[1] === "-" && minor !== 0 ? -minor : minor;
}

/**
 * Exact plain decimal string for money at its currency's full precision,
 * for Prisma Decimal writes and CSV: "1234.56", "-0.05", "1200" (JPY),
 * "0.00400000" (ETH). No grouping, no symbol. Display goes through
 * formatMoney instead.
 */
export function fromMinor(value: Money): string {
	const { minor, currency } = money(value.minor, value.currency);
	const decimals = currencyDecimals(currency);
	const digits = String(Math.abs(minor)).padStart(decimals + 1, "0");
	const sign = minor < 0 ? "-" : "";
	if (decimals === 0) return sign + digits;
	const cut = digits.length - decimals;
	return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

function sameCurrency(a: Money, b: Money): string {
	const left = money(a.minor, a.currency);
	const right = money(b.minor, b.currency);
	if (left.currency !== right.currency) {
		throw new CurrencyMismatchError(left.currency, right.currency);
	}
	return left.currency;
}

/** a + b; throws CurrencyMismatchError across currencies, RangeError on overflow. */
export function addMoney(a: Money, b: Money): Money {
	return money(a.minor + b.minor, sameCurrency(a, b));
}

/** a - b; throws CurrencyMismatchError across currencies, RangeError on overflow. */
export function subtractMoney(a: Money, b: Money): Money {
	return money(a.minor - b.minor, sameCurrency(a, b));
}
