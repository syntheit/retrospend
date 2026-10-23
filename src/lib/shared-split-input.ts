/**
 * The split a shared expense form sends to the server, built from its split
 * state. One function for today's expense form and the v2 Add expense sheet
 * (it was written twice in use-expense-form). The server resolves the amounts
 * through resolveSplits; this only shapes the rows and the mode.
 */

export type SplitRefType = "user" | "guest" | "shadow";

export interface SplitRef {
	participantType: SplitRefType;
	participantId: string;
}

export type SplitModeKey = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface SplitRow extends SplitRef {
	shareAmount?: number;
	sharePercentage?: number;
	shareUnits?: number;
}

export interface SplitState {
	mode: SplitModeKey;
	/** The current user, as a participant. */
	you: SplitRef;
	youIncluded: boolean;
	/** Every other member of the split. */
	others: readonly SplitRef[];
	paidBy: SplitRef;
	/** "X owes all": only for You plus one other person. */
	fullAmount: boolean;
	amount: number;
	/** Keyed by `${participantType}:${participantId}`. */
	exact: Readonly<Record<string, number>>;
	percentages: Readonly<Record<string, number>>;
	shares: Readonly<Record<string, number>>;
}

export const splitKey = (p: SplitRef) =>
	`${p.participantType}:${p.participantId}`;

/** You (when included) and the others, each once. */
export function splitMembers(
	s: Pick<SplitState, "you" | "youIncluded" | "others">,
) {
	const seen = new Set<string>();
	return [...(s.youIncluded ? [s.you] : []), ...s.others]
		.map((p) => ({
			participantType: p.participantType,
			participantId: p.participantId,
		}))
		.filter((p) => {
			const key = splitKey(p);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

/**
 * "Full amount" for one other person: the non-payer bears the whole cost and
 * the payer gets no row (they fronted it), so "You owe all" and "They owe
 * all" resolve to the right debtor whoever paid.
 */
export function fullAmountSplit(
	you: SplitRef,
	other: SplitRef,
	paidBy: SplitRef,
	amount: number,
): SplitRow[] {
	const payerIsYou = splitKey(paidBy) === splitKey(you);
	return [{ ...(payerIsYou ? other : you), shareAmount: amount }];
}

/** Whether "X owes all" applies to this state. */
export function isFullAmount(s: SplitState): boolean {
	return s.fullAmount && s.youIncluded && s.others.length === 1;
}

/** The rows and mode to send. */
export function buildSplitInput(s: SplitState): {
	splitWith: SplitRow[];
	splitMode: SplitModeKey;
} {
	const members = splitMembers(s);
	const other = s.others[0];
	if (s.mode === "EQUAL" && isFullAmount(s) && other) {
		return {
			splitWith: fullAmountSplit(s.you, other, s.paidBy, s.amount),
			splitMode: "EXACT",
		};
	}
	const rows = members.map((p): SplitRow => {
		const key = splitKey(p);
		if (s.mode === "EXACT") return { ...p, shareAmount: s.exact[key] ?? 0 };
		if (s.mode === "PERCENTAGE")
			return {
				...p,
				sharePercentage: s.percentages[key] ?? 100 / members.length,
			};
		if (s.mode === "SHARES") return { ...p, shareUnits: s.shares[key] ?? 1 };
		return p;
	});
	return { splitWith: rows, splitMode: s.mode };
}
