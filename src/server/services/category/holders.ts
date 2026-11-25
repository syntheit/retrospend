/**
 * The server's adapter for every holder of a category id, keyed by the
 * domain's holder list (category-merge/holders.ts). The record type makes a
 * holder added there fail to compile until it has an adapter here, and the
 * merge and its undo both walk `HOLDER_IDS`, so neither can skip one.
 */
import {
	HOLDER_IDS,
	type HolderId,
} from "@retrospend/domain/category-merge/holders";
import type { HolderAdapter } from "./holder";
import {
	budgetHolder,
	envelopeLinkHolder,
	preferenceHolder,
} from "./holders-budget";
import { draftHolder, incomeRuleHolder } from "./holders-loose";
import {
	expenseHolder,
	sharedTransactionHolder,
	shareHolder,
	templateHolder,
} from "./holders-rows";

const erased = <H>(adapter: HolderAdapter<H>) =>
	adapter as unknown as HolderAdapter<unknown>;

export const HOLDERS: Readonly<Record<HolderId, HolderAdapter<unknown>>> = {
	expense: erased(expenseHolder),
	template: erased(templateHolder),
	sharedTransaction: erased(sharedTransactionHolder),
	share: erased(shareHolder),
	budget: erased(budgetHolder),
	envelopeLink: erased(envelopeLinkHolder),
	preference: erased(preferenceHolder),
	incomeRule: erased(incomeRuleHolder),
	draft: erased(draftHolder),
};

/** The order the move runs in; the undo runs it backwards. */
export const MOVE_ORDER: readonly HolderId[] = HOLDER_IDS;
