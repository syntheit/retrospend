/**
 * Money as integer minor units: the one DTO shape every client and the
 * server exchange ({ minor, currency }). Minor units follow currencyDecimals
 * (ISO 4217 for fiat, 8 for crypto, 2 for stablecoins), so 1234 USD minor is
 * 12.34 and 400000 ETH minor is 0.004. Integers keep sums exact; a safe
 * integer covers BTC 21M (2.1e15 satoshis) and ARS 1e12 (1e14 cents).
 */
import { isPrismaDecimal, type PrismaDecimal } from "./decimal";
import { currencyDecimals, toMinorUnits } from "./money";

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
 * A number goes through toMinorUnits, which rounds away float noise, so the
 * result matches what the expense form and split math already store. A
 * string or Prisma Decimal is read exactly (BTC 20999999.12345678 has more
 * digits than a float keeps) and refused when it is more precise than the
 * currency, since a stored amount should never need rounding.
 */
export function toMinor(
	amount: number | string | PrismaDecimal,
	currency: string,
): number {
	if (typeof amount === "number") {
		if (!Number.isFinite(amount)) {
			throw new RangeError(`Amount must be finite, got ${amount}`);
		}
		return assertSafeMinor(toMinorUnits(amount, currency));
	}
	const text = isPrismaDecimal(amount) ? amount.toString() : amount;
	return decimalTextToMinor(text, currencyDecimals(currency));
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
