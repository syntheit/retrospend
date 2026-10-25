/**
 * The correction plan (MONEY-MOVES 1.11): pure, in minor units.
 *
 * A split is the sum of its original row and every correction row. A row
 * has one payer, one category and per-person shares; a pair balance is the
 * sum of shares per payer, so rows add. "Correct" says what the split should
 * be now; the plan is the difference between that and what it is now, as
 * the fewest rows that carry only the difference:
 *
 * - Same payer and category: one row with the amount and share differences
 *   (Electricidad 45,000 to 48,000: +3,000 paid, +1,000 each).
 * - Another payer or category: the old bucket is reversed in full (negative
 *   amount and shares) and the new one is added in full. A pair that does
 *   not change nets to zero in the balances.
 *
 * The original is never touched. Negative shares exist on correction rows
 * only.
 */
import { sumMinor } from "../envelope/units";

export interface Party {
	readonly participantType: "user" | "guest" | "shadow";
	readonly participantId: string;
}

export interface ShareLine {
	readonly party: Party;
	readonly minor: number;
}

/** One existing row of the split: the original or a correction. */
export interface RowState {
	readonly payer: Party;
	readonly categoryId: string | null;
	readonly amountMinor: number;
	readonly shares: readonly ShareLine[];
}

/** What the split should be after the correction. */
export interface DesiredState {
	readonly payer: Party;
	readonly categoryId: string | null;
	readonly amountMinor: number;
	readonly shares: readonly ShareLine[];
}

/** One correction row to write. */
export interface PlannedRow {
	readonly payer: Party;
	readonly categoryId: string | null;
	/** Difference in what was paid; negative reverses an old bucket. */
	readonly amountMinor: number;
	/** Differences in shares; never zero. */
	readonly shares: readonly ShareLine[];
}

export const partyKey = (p: Party) => `${p.participantType}:${p.participantId}`;

/** People in one order whatever order the rows came in (database rows have none). */
const byParty = (a: { party: Party }, b: { party: Party }) =>
	partyKey(a.party) < partyKey(b.party) ? -1 : 1;

interface Bucket {
	payer: Party;
	categoryId: string | null;
	amount: number;
	shares: Map<string, ShareLine>;
}

const bucketKey = (payer: Party, categoryId: string | null) =>
	`${partyKey(payer)}|${categoryId ?? ""}`;

function bucketIn(
	buckets: Map<string, Bucket>,
	payer: Party,
	categoryId: string | null,
): Bucket {
	const key = bucketKey(payer, categoryId);
	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = { payer, categoryId, amount: 0, shares: new Map() };
		buckets.set(key, bucket);
	}
	return bucket;
}

function add(
	bucket: Bucket,
	amount: number,
	shares: readonly ShareLine[],
	sign: 1 | -1,
) {
	bucket.amount += sign * amount;
	for (const line of shares) {
		const key = partyKey(line.party);
		const seen = bucket.shares.get(key);
		bucket.shares.set(key, {
			party: line.party,
			minor: (seen?.minor ?? 0) + sign * line.minor,
		});
	}
}

/** Thrown when the desired state does not add up; the caller maps it to a bad request. */
export class CorrectionPlanError extends Error {}

/**
 * The rows that turn `effective` into `desired`. Empty when nothing
 * changes. Reversals come first so a reader sees the old bucket go before
 * the new one arrives.
 */
export function planCorrection(
	effective: readonly RowState[],
	desired: DesiredState,
): PlannedRow[] {
	if (sumMinor(desired.shares.map((s) => s.minor)) !== desired.amountMinor) {
		throw new CorrectionPlanError("the shares must add up to the amount");
	}
	if (desired.shares.some((s) => s.minor < 0)) {
		throw new CorrectionPlanError("a share cannot be negative");
	}
	const buckets = new Map<string, Bucket>();
	for (const row of effective) {
		add(
			bucketIn(buckets, row.payer, row.categoryId),
			row.amountMinor,
			row.shares,
			-1,
		);
	}
	add(
		bucketIn(buckets, desired.payer, desired.categoryId),
		desired.amountMinor,
		desired.shares,
		1,
	);
	const rows: PlannedRow[] = [];
	for (const bucket of buckets.values()) {
		const shares = [...bucket.shares.values()]
			.filter((s) => s.minor !== 0)
			.sort(byParty);
		if (bucket.amount === 0 && shares.length === 0) continue;
		rows.push({
			payer: bucket.payer,
			categoryId: bucket.categoryId,
			amountMinor: bucket.amount,
			shares,
		});
	}
	return rows.sort(
		(a, b) => Math.sign(a.amountMinor) - Math.sign(b.amountMinor),
	);
}

/** One person's part of a correction: what they paid and what they owe more or less. */
export interface PersonDifference {
	readonly party: Party;
	/** Positive: paid more than before. */
	readonly paidMinor: number;
	/** Positive: owes more than before. */
	readonly shareMinor: number;
}

/** The per-person difference a correction makes, for the sheet to state (one line per person). */
export function differencesOf(rows: readonly PlannedRow[]): PersonDifference[] {
	const people = new Map<
		string,
		{ party: Party; paid: number; share: number }
	>();
	const person = (party: Party) => {
		const key = partyKey(party);
		let line = people.get(key);
		if (!line) {
			line = { party, paid: 0, share: 0 };
			people.set(key, line);
		}
		return line;
	};
	for (const row of rows) {
		person(row.payer).paid += row.amountMinor;
		for (const share of row.shares) person(share.party).share += share.minor;
	}
	return [...people.values()]
		.filter((p) => p.paid !== 0 || p.share !== 0)
		.sort((a, b) => byParty({ party: a.party }, { party: b.party }))
		.map((p) => ({ party: p.party, paidMinor: p.paid, shareMinor: p.share }));
}
