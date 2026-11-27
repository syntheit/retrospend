import { moveDay as domainMoveDay } from "@retrospend/domain/accounts/move-day";
import { AccountRefusal } from "@retrospend/domain/accounts/refusals";
import { TRPCError } from "@trpc/server";

/**
 * The calendar day a money move is dated, as a UTC midnight: the day the
 * client sent, else today in the user's zone. Never a future day. The rule is
 * the domain's (the device books with the same one); this only maps its
 * refusal to the transport's.
 */
export function moveDay(
	day: string | null | undefined,
	now: Date,
	timeZone?: string,
): Date {
	try {
		return domainMoveDay(day, now, timeZone);
	} catch (error) {
		if (error instanceof AccountRefusal)
			throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
		throw error;
	}
}
