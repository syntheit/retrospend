/**
 * The pure part of account.setRateType (D3): an account is valued at one
 * rate type at a time, switched from a day on. The rows are dated and
 * chained: each row's previousType is the type the row before it set, and
 * the first row's is the type the account had before any switch, so removing
 * any one row leaves the others exact.
 */

export interface RateSwitchRow {
	readonly id: string;
	readonly from: Date;
	readonly type: string | null;
	readonly previousType: string | null;
	/** Breaks a tie of `from`: a second switch on the same day replaces the first. */
	readonly createdAt: Date;
}

export interface RateSwitchPlanInput {
	/** The account's switches, any order. */
	readonly rows: readonly RateSwitchRow[];
	/** The account's exchangeRateType now. */
	readonly current: string | null;
	/** The day the type applies from, a UTC midnight, never in the future. */
	readonly from: Date;
	readonly rateType: string | null;
}

export interface RateSwitchPlan {
	/** The new asset_rate_type row. */
	readonly insert: {
		readonly from: Date;
		readonly type: string | null;
		readonly previousType: string | null;
	};
	/** The next switch after `from`, whose previousType is now the new type. */
	readonly repoint: {
		readonly id: string;
		readonly previousType: string | null;
	} | null;
	/** The account's new exchangeRateType; null when a later switch stays in force. */
	readonly accountRateType: { readonly value: string | null } | null;
}

/** Force order: by day, then by when each was written. */
function inForceOrder(rows: readonly RateSwitchRow[]): RateSwitchRow[] {
	return [...rows].sort(
		(a, b) =>
			a.from.getTime() - b.from.getTime() ||
			a.createdAt.getTime() - b.createdAt.getTime(),
	);
}

export function rateSwitchPlan(input: RateSwitchPlanInput): RateSwitchPlan {
	const rows = inForceOrder(input.rows);
	const first = rows[0];
	const base = first ? first.previousType : input.current;
	const at = input.from.getTime();
	const earlier = rows.filter((r) => r.from.getTime() <= at).at(-1);
	const next = rows.find((r) => r.from.getTime() > at);
	return {
		insert: {
			from: input.from,
			type: input.rateType,
			previousType: earlier ? earlier.type : base,
		},
		repoint: next ? { id: next.id, previousType: input.rateType } : null,
		accountRateType: next ? null : { value: input.rateType },
	};
}
