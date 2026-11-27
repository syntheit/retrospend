/**
 * The counted units of an account when a transfer is deleted (D4): the
 * source gets back what the move took, the destination gives back what it
 * took (never below zero, since its counted units may have moved on), then
 * the account is capped at what it holds. The device calls this; the
 * server's delete (services/transfers/delete.mutation.ts) writes the same
 * three steps in SQL (an increment, GREATEST(0, ...), account_cap_counted),
 * and the transfer conformance vectors hold the two equal where the floor and
 * the cap each bind.
 */
import { cappedCounted } from "../accounts/places";
import { type Decimal, dec } from "../precise-decimal";

export function countedAfterDelete(
	account: {
		readonly type: string;
		readonly countedUnits: Decimal;
		readonly balance: Decimal;
	},
	moved: { readonly give: Decimal; readonly take: Decimal },
): Decimal {
	const given = account.countedUnits.add(moved.give);
	const left = given.sub(moved.take);
	return cappedCounted(
		account.type,
		left.lt(0) ? dec(0) : left,
		account.balance,
	);
}
