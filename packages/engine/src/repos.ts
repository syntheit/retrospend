/**
 * The typed repositories, one per aggregate. Each is a thin layer over a
 * Reader or Writer, so the same code runs on the store, a transaction or a
 * savepoint. Device writes reach them through LocalDb (local-db.ts), which
 * records what they change.
 */
import { accountReads, accountRepo } from "./accounts";
import { budgetReads } from "./budget-reads";
import { expenseReads, expenseRepo } from "./expenses";
import { movementReads, movementRepo } from "./movements";
import type { Reader, Writer } from "./port";
import {
	categoryReads,
	rateReads,
	settingsReads,
	transferReads,
	transferRepo,
	wealthMoveReads,
} from "./reference";
import { templateReads, templateRepo } from "./templates";

export interface Repos {
	expenses: ReturnType<typeof expenseRepo>;
	accounts: ReturnType<typeof accountRepo>;
	budgetMovements: ReturnType<typeof movementRepo>;
	recurringTemplates: ReturnType<typeof templateRepo>;
	/** Read-only: a write prices with them and never changes them. */
	settings: ReturnType<typeof settingsReads>;
	rates: ReturnType<typeof rateReads>;
	categories: ReturnType<typeof categoryReads>;
	transfers: ReturnType<typeof transferRepo>;
	/** Read-only: the budget's side of a move arrives with a pull. */
	wealthMoves: ReturnType<typeof wealthMoveReads>;
	/** Whether the budget can be read, and the book it is kept in. */
	budget: ReturnType<typeof budgetReads>;
}

export interface ReadRepos {
	expenses: ReturnType<typeof expenseReads>;
	accounts: ReturnType<typeof accountReads>;
	budgetMovements: ReturnType<typeof movementReads>;
	recurringTemplates: ReturnType<typeof templateReads>;
	settings: ReturnType<typeof settingsReads>;
	rates: ReturnType<typeof rateReads>;
	categories: ReturnType<typeof categoryReads>;
	transfers: ReturnType<typeof transferReads>;
	wealthMoves: ReturnType<typeof wealthMoveReads>;
	budget: ReturnType<typeof budgetReads>;
}

export const repos = (w: Writer): Repos => ({
	expenses: expenseRepo(w),
	accounts: accountRepo(w),
	budgetMovements: movementRepo(w),
	recurringTemplates: templateRepo(w),
	settings: settingsReads(w),
	rates: rateReads(w),
	categories: categoryReads(w),
	transfers: transferRepo(w),
	wealthMoves: wealthMoveReads(w),
	budget: budgetReads(w),
});

export const readRepos = (r: Reader): ReadRepos => ({
	expenses: expenseReads(r),
	accounts: accountReads(r),
	budgetMovements: movementReads(r),
	recurringTemplates: templateReads(r),
	settings: settingsReads(r),
	rates: rateReads(r),
	categories: categoryReads(r),
	transfers: transferReads(r),
	wealthMoves: wealthMoveReads(r),
	budget: budgetReads(r),
});
