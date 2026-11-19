/**
 * Which rows an edit or a delete may reach. The Activity mutations pass
 * ENTRY_POLICY (your own spending, one row at a time); the older service
 * paths pass ANY_POLICY and keep reaching every row of the person's, as they
 * always did (income, spread parts and a transfer's fee included).
 */
import { EditRefusal, EXPENSE_NOT_FOUND, LEG_DELETE_REFUSED } from "./refusals";

export interface EditPolicy {
	/** Only outgoing rows that are not a spread part are reachable; others are not found. */
	outgoingOnly: boolean;
	/** A row an account leg names (a transfer's fee) cannot be deleted. */
	refuseLegDelete: boolean;
}

export const ENTRY_POLICY: EditPolicy = {
	outgoingOnly: true,
	refuseLegDelete: true,
};

export const ANY_POLICY: EditPolicy = {
	outgoingOnly: false,
	refuseLegDelete: false,
};

export interface ReachFacts {
	direction: string;
	isAmortizedChild: boolean;
	/** An account leg names the row: a transfer's fee. */
	hasLegs: boolean;
}

/** The person's row the policy lets through, or the refusal (a hidden row is not found). */
export function reach<R extends ReachFacts>(
	row: R | null | undefined,
	policy: EditPolicy,
): R {
	if (
		!row ||
		(policy.outgoingOnly && (row.direction !== "OUT" || row.isAmortizedChild))
	)
		throw new EditRefusal("notFound", EXPENSE_NOT_FOUND);
	return row;
}

export function checkDeletable(row: ReachFacts, policy: EditPolicy): void {
	if (policy.refuseLegDelete && row.hasLegs)
		throw new EditRefusal("badRequest", LEG_DELETE_REFUSED);
}
