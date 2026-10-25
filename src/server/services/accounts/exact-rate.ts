import { TRPCError } from "@trpc/server";
import { dec } from "~/server/services/envelope/units";

/**
 * A typed rate arrives as decimal text and the account services still hold a
 * rate as a number, so the text must survive being one: a rate a double would
 * change is refused, never stored altered.
 */
export function exactRate(text: string, field: string): number {
	const n = Number(text);
	if (!dec(String(n)).eq(dec(text)))
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `${field} ${text} has too many digits to keep exactly`,
		});
	return n;
}

/** The account fields with their `exchangeRate` text read as the number the services take. */
export function withRateNumber<T extends { exchangeRate?: string }>(
	fields: T,
): Omit<T, "exchangeRate"> & { exchangeRate?: number } {
	const { exchangeRate, ...rest } = fields;
	return exchangeRate === undefined
		? rest
		: { ...rest, exchangeRate: exactRate(exchangeRate, "exchangeRate") };
}
