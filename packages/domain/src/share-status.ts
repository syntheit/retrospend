/**
 * Which share statuses stay out of every figure. A participant who rejected
 * their share does not owe it: balances, spending and the budget all skip it
 * (the payer's budget still fronts the cash, see the envelope replay). One
 * list, so no reader pastes its own filter.
 */
export const UNCOUNTED_SHARE_STATUSES = ["REJECTED"] as const;

/** True when a share in this status counts toward balances and spending. */
export function shareCounts(status: string): boolean {
	return !(UNCOUNTED_SHARE_STATUSES as readonly string[]).includes(status);
}
