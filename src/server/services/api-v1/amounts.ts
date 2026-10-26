import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "@retrospend/domain/money";

/**
 * Amounts come in as decimal text and are never rounded on the way in. A
 * value with more decimals than the currency's minor unit would be rounded
 * into somebody's balance, so it is refused (400). The split service still
 * takes a JavaScript number, so a split amount is also refused when a double
 * cannot hold it exactly (more than 15 digits).
 */
const MAX_SIGNIFICANT_DIGITS = 15;

const refuse = (message: string) =>
	new TRPCError({ code: "BAD_REQUEST", message });

/** Refuses an amount with more decimals than the currency has. */
export function assertMinorUnits(
	text: string | null | undefined,
	currency: string,
	field = "amount",
) {
	if (!text) return;
	const decimals = currencyDecimals(currency);
	const fraction = text.split(".")[1] ?? "";
	if (fraction.length > decimals)
		throw refuse(
			`${field} ${text} has more decimals than ${currency} allows (${decimals})`,
		);
}

/** The number for a split amount, once it is exactly the text. */
export function exactAmount(
	text: string,
	currency: string,
	field = "amount",
): number {
	assertMinorUnits(text, currency, field);
	const [whole = "", fraction = ""] = text.split(".");
	if (`${whole}${fraction}`.replace(/^0+/, "").length > MAX_SIGNIFICANT_DIGITS)
		throw refuse(`${field} ${text} has too many digits to split exactly`);
	return Number(text);
}
