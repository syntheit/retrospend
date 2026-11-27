import { rateRefusal } from "@retrospend/domain/accounts/refusals";
import { TRPCError } from "@trpc/server";

/**
 * A typed rate arrives as decimal text and the account services still hold a
 * rate as a number, so the text must survive being one: a rate a double would
 * change is refused, never stored altered.
 */
export function exactRate(text: string, field: string): number {
	const message = rateRefusal(text, field);
	if (message !== null) throw new TRPCError({ code: "BAD_REQUEST", message });
	return Number(text);
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
