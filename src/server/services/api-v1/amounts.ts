import {
	amountRefusal,
	excessDecimals,
} from "@retrospend/domain/accounts/refusals";
import { TRPCError } from "@trpc/server";

/**
 * Amounts come in as decimal text and are never rounded on the way in. A
 * value with more decimals than the currency's minor unit would be rounded
 * into somebody's balance, so it is refused (400). The split service still
 * takes a JavaScript number, so a split amount is also refused when a double
 * cannot hold it exactly (more than 15 digits).
 */
const refuse = (message: string) =>
	new TRPCError({ code: "BAD_REQUEST", message });

/** Refuses an amount with more decimals than the currency has. */
export function assertMinorUnits(
	text: string | null | undefined,
	currency: string,
	field = "amount",
) {
	const message = excessDecimals(text, currency, field);
	if (message !== null) throw refuse(message);
}

/** The number for a split amount, once it is exactly the text. */
export function exactAmount(
	text: string,
	currency: string,
	field = "amount",
): number {
	const message = amountRefusal(text, currency, field);
	if (message !== null) throw refuse(message);
	return Number(text);
}
