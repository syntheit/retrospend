import { fromMinorUnits, toMinorUnits } from "@retrospend/domain/money";
import {
	allocateByWeights,
	remainderRow,
} from "@retrospend/domain/shared-split-computation";
import type { ParticipantRef } from "./types";

type Share = {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
	shareAmount: number;
};

/**
 * Proportionally rescales stored EXACT shares to a new total. Each share keeps
 * its fraction of the old total; the leftover minor unit from flooring goes to
 * the payer first (else the last row), matching the rounding rule used
 * elsewhere. `fromCurrency` is the currency the stored shares are in, when an
 * edit changes it: the new shares are in `currency`'s minor units.
 * If the old total was 0 (no proportion to preserve), `equal` splits the new
 * amount equally so the shares still sum to it.
 */
export function rescaleExactSplits<S extends Share>(input: {
	oldAmount: number;
	newAmount: number;
	currency: string;
	fromCurrency: string;
	splits: S[];
	paidBy: ParticipantRef;
	equal: () => {
		participantType: S["participantType"];
		participantId: string;
		shareAmount?: number;
	}[];
}) {
	const { currency, fromCurrency, splits, paidBy } = input;
	if (toMinorUnits(input.oldAmount, fromCurrency) === 0) return input.equal();
	// Exact BigInt allocation: newTotal * oldShare overflows a float near 1e12 units.
	const oldShares = splits.map((p) =>
		toMinorUnits(p.shareAmount, fromCurrency),
	);
	if (oldShares.reduce((s, v) => s + v, 0) === 0) return input.equal();
	const cents = allocateByWeights(
		toMinorUnits(input.newAmount, currency),
		oldShares,
		remainderRow(splits, paidBy),
	);
	return splits.map((p, i) => ({
		participantType: p.participantType,
		participantId: p.participantId,
		shareAmount: fromMinorUnits(cents[i] ?? 0, currency),
	}));
}
