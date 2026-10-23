/**
 * The split rows' amounts while you type, from the one split path the
 * server also uses (resolveSplits), so a row shows what Save stores.
 * Display only (R9 holds): nothing computed here is sent. The server
 * resolves the split again from the rows and mode it receives, and the
 * preview's figures come from that.
 */
import { toMinorUnits } from "@retrospend/domain/money";
import {
	resolveSplits,
	SplitComputationError,
} from "@retrospend/domain/shared-split-computation";
import {
	buildSplitInput,
	type SplitRef,
	splitKey,
} from "~/lib/shared-split-input";
import { type ExpenseDraft, splitStateOf } from "./draft";

/** Each member's share in minor units by splitKey, or null while the split does not resolve yet. */
export function sharesOf(
	d: ExpenseDraft,
	you: SplitRef,
): ReadonlyMap<string, number> | null {
	if (!d.minor) return null;
	const state = splitStateOf(d, you);
	const { splitWith, splitMode } = buildSplitInput(state);
	if (splitWith.length === 0) return null;
	try {
		const rows = resolveSplits({
			mode: splitMode,
			amount: state.amount,
			currency: d.currency,
			participants: splitWith,
			paidBy: d.paidBy,
		});
		return new Map(
			rows.map((r) => [splitKey(r), toMinorUnits(r.shareAmount, d.currency)]),
		);
	} catch (error) {
		if (error instanceof SplitComputationError) return null;
		throw error;
	}
}
