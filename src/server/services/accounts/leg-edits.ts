/**
 * An income or a transfer fee that moved money in an account has a leg with
 * its amount, currency and day. An edit from Activity would change the row
 * but not the leg, so the account would disagree with it: those edits are
 * refused until an income edit rewrites the leg (docs/ui/GAPS.md). Title,
 * category and notes stay editable.
 */
import { TRPCError } from "@trpc/server";
import { dec } from "~/server/services/envelope/units";

export function refuseLegMoneyEdit(
	existing: {
		amount: { toString(): string };
		currency: string;
		date: Date;
		/** Absent on rows read without the count: no leg known. */
		_count?: { accountLegs: number };
	},
	input: { amount: number | string; currency: string; date: Date },
): void {
	if ((existing._count?.accountLegs ?? 0) === 0) return;
	const changesMoney =
		!dec(existing.amount.toString()).eq(dec(String(input.amount))) ||
		existing.currency !== input.currency ||
		existing.date.getTime() !== input.date.getTime();
	if (!changesMoney) return;
	throw new TRPCError({
		code: "BAD_REQUEST",
		message:
			"This entry moved money in an account. Delete it and add it again to change its amount, currency or date.",
	});
}
