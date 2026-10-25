import { toMinorUnits } from "@retrospend/domain/money";
import { fromMinor } from "@retrospend/domain/money-minor";
import type { CorrectInput } from "~/lib/schemas/corrections";
import type { SplitRef } from "~/lib/shared-split-input";
import { type ExpenseDraft, sharedInput } from "../entry/expense/draft";

/** A participant the way the corrections contract names one. */
const refOf = (p: SplitRef) => ({
	type: p.participantType,
	id: p.participantId,
});

/** A typed number as the contract's decimal string, through minor units (no exponent forms). */
const decimal = (n: number, currency: string) =>
	fromMinor({ minor: toMinorUnits(n, currency), currency });

/**
 * What the Correct sheet sends: the whole split as the form now stands. The
 * server works out the difference from what was booked (and refuses a
 * split that does not add up), so this only shapes the rows. Null while
 * the form has no amount or category yet.
 */
export function correctionInput(
	d: ExpenseDraft,
	o: { id: string; transactionId: string; title: string; you: SplitRef },
): CorrectInput | null {
	const s = sharedInput(d, { you: o.you, categoryName: "" });
	if (!s) return null;
	return {
		id: o.id,
		transactionId: o.transactionId,
		description: o.title,
		amount: s.amount,
		paidBy: refOf(s.paidBy),
		categoryId: s.categoryId,
		splitMode: s.splitMode,
		splitWith: s.splitWith.map((row) => ({
			participant: refOf(row),
			...(row.shareAmount === undefined
				? {}
				: { shareAmount: decimal(row.shareAmount, d.currency) }),
			...(row.sharePercentage === undefined
				? {}
				: { sharePercentage: row.sharePercentage }),
			...(row.shareUnits === undefined ? {} : { shareUnits: row.shareUnits }),
		})),
	};
}
