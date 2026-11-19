/**
 * The one category rule for an expense write: the category must exist, be the
 * person's (the adapter's lookup is scoped to them) and be an expense
 * category. Every writer calls this; none re-states the kind check.
 */
import { CategoryNotFoundError, type CategoryRefusalCode } from "./refusals";

/** The facts of a category a write needs. */
export interface CategoryFacts {
	id: string;
	kind: string;
	/** New expenses in it start out excluded from analytics, unless the form says otherwise. */
	excludeByDefault: boolean;
}

/** `found` is the person's category row for the id, or null/undefined when there is none. */
export function expenseCategory(
	found: CategoryFacts | null | undefined,
	v1Code: CategoryRefusalCode,
): CategoryFacts {
	if (found?.kind !== "EXPENSE") throw new CategoryNotFoundError(v1Code);
	return found;
}
