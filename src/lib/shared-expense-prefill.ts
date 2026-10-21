/**
 * Maps a saved shared expense onto the expense form's split state for editing.
 *
 * Pure and isomorphic so it can be unit tested. The mapping must round-trip:
 * opening an expense and saving it without changes has to produce the same
 * payer and split rows. Two saved shapes need care because the form does not
 * store them literally:
 *
 * - "Full amount" (one person covers everything for the other): saved as a
 *   single split row for the non-payer carrying the whole amount, with no row
 *   for the payer. When that pair is You plus one other person, it reopens as
 *   You + them with the full-amount toggle on (see fullAmountSplit in
 *   use-expense-form), whichever of the two paid.
 * - Payer outside the split (someone paid for others and took no share):
 *   the payer is returned as `outsidePayer` so the form keeps offering and
 *   keeping them as the payer instead of falling back to a split member.
 */

export type PrefillParticipantType = "user" | "guest" | "shadow";

export interface PrefillRef {
	participantType: PrefillParticipantType;
	participantId: string;
}

export interface PrefillPerson extends PrefillRef {
	name: string;
	avatarUrl?: string | null;
}

export interface SharedTxForPrefill {
	amount: number;
	splitMode: string;
	paidBy: { participantType: string; participantId: string; name: string; avatarUrl?: string | null };
	splitParticipants: Array<{
		participantType: string;
		participantId: string;
		name: string;
		avatarUrl?: string | null;
		shareAmount?: number | null;
		sharePercentage?: number | null;
		shareUnits?: number | null;
	}>;
}

export type PrefillSplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface SharedExpensePrefill {
	paidBy: PrefillRef;
	splitMode: PrefillSplitMode;
	/** Every split member other than the current user. */
	splitWith: Array<PrefillPerson & { email: null }>;
	youIncluded: boolean;
	theyOweFullAmount: boolean;
	exactAmounts: Record<string, number>;
	percentages: Record<string, number>;
	shares: Record<string, number>;
	/** The payer, when they are not a member of the split. */
	outsidePayer: PrefillPerson | null;
}

const AMOUNT_TOLERANCE = 0.005;

const keyOf = (r: { participantType: string; participantId: string }) =>
	`${r.participantType}:${r.participantId}`;

const sameRef = (
	a: { participantType: string; participantId: string },
	b: { participantType: string; participantId: string },
) => a.participantType === b.participantType && a.participantId === b.participantId;

function toPerson(p: {
	participantType: string;
	participantId: string;
	name: string;
	avatarUrl?: string | null;
}): PrefillPerson & { email: null } {
	return {
		participantType: p.participantType as PrefillParticipantType,
		participantId: p.participantId,
		name: p.name,
		email: null,
		avatarUrl: p.avatarUrl ?? null,
	};
}

function toSplitMode(mode: string): PrefillSplitMode {
	return mode === "EXACT" || mode === "PERCENTAGE" || mode === "SHARES"
		? mode
		: "EQUAL";
}

export function buildSharedExpensePrefill(
	tx: SharedTxForPrefill,
	me: PrefillRef,
): SharedExpensePrefill {
	const paidBy: PrefillRef = {
		participantType: tx.paidBy.participantType as PrefillParticipantType,
		participantId: tx.paidBy.participantId,
	};
	const rows = tx.splitParticipants;
	const payerIsMe = sameRef(paidBy, me);

	// Full-amount expense between You and one other person.
	const only = rows.length === 1 ? rows[0]! : null;
	if (
		only &&
		!sameRef(only, paidBy) &&
		Math.abs((only.shareAmount ?? 0) - tx.amount) < AMOUNT_TOLERANCE &&
		(payerIsMe || sameRef(only, me))
	) {
		const other = payerIsMe ? only : tx.paidBy;
		return {
			paidBy,
			// The form models "full amount" as EQUAL + the toggle; the submit path
			// turns it back into a single EXACT row for the non-payer.
			splitMode: "EQUAL",
			splitWith: [toPerson(other)],
			youIncluded: true,
			theyOweFullAmount: true,
			exactAmounts: {},
			percentages: {},
			shares: {},
			outsidePayer: null,
		};
	}

	const splitMode = toSplitMode(tx.splitMode);
	const exactAmounts: Record<string, number> = {};
	const percentages: Record<string, number> = {};
	const shares: Record<string, number> = {};
	for (const sp of rows) {
		const k = keyOf(sp);
		if (splitMode === "EXACT") exactAmounts[k] = sp.shareAmount ?? 0;
		else if (splitMode === "PERCENTAGE") percentages[k] = sp.sharePercentage ?? 0;
		else if (splitMode === "SHARES") shares[k] = sp.shareUnits ?? 1;
	}

	const payerInSplit = rows.some((sp) => sameRef(sp, paidBy));

	return {
		paidBy,
		splitMode,
		splitWith: rows.filter((sp) => !sameRef(sp, me)).map(toPerson),
		youIncluded: rows.some((sp) => sameRef(sp, me)),
		theyOweFullAmount: false,
		exactAmounts,
		percentages,
		shares,
		outsidePayer: payerInSplit
			? null
			: {
					participantType: paidBy.participantType,
					participantId: paidBy.participantId,
					name: tx.paidBy.name,
					avatarUrl: tx.paidBy.avatarUrl ?? null,
				},
	};
}
