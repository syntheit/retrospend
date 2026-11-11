/**
 * The typed repositories, one per aggregate. Each is a thin layer over a
 * Reader or Writer, so the same code runs on the store, a transaction or a
 * savepoint. Device writes reach them through LocalDb (local-db.ts), which
 * records what they change.
 */
import { accountReads, accountRepo } from "./accounts";
import { expenseReads, expenseRepo } from "./expenses";
import { movementReads, movementRepo } from "./movements";
import type { Reader, Writer } from "./port";
import { rateReads, settingsReads } from "./reference";
import { templateReads, templateRepo } from "./templates";

export interface Repos {
	expenses: ReturnType<typeof expenseRepo>;
	accounts: ReturnType<typeof accountRepo>;
	budgetMovements: ReturnType<typeof movementRepo>;
	recurringTemplates: ReturnType<typeof templateRepo>;
	/** Read-only: a write prices with them and never changes them. */
	settings: ReturnType<typeof settingsReads>;
	rates: ReturnType<typeof rateReads>;
}

export interface ReadRepos {
	expenses: ReturnType<typeof expenseReads>;
	accounts: ReturnType<typeof accountReads>;
	budgetMovements: ReturnType<typeof movementReads>;
	recurringTemplates: ReturnType<typeof templateReads>;
	settings: ReturnType<typeof settingsReads>;
	rates: ReturnType<typeof rateReads>;
}

export const repos = (w: Writer): Repos => ({
	expenses: expenseRepo(w),
	accounts: accountRepo(w),
	budgetMovements: movementRepo(w),
	recurringTemplates: templateRepo(w),
	settings: settingsReads(w),
	rates: rateReads(w),
});

export const readRepos = (r: Reader): ReadRepos => ({
	expenses: expenseReads(r),
	accounts: accountReads(r),
	budgetMovements: movementReads(r),
	recurringTemplates: templateReads(r),
	settings: settingsReads(r),
	rates: rateReads(r),
});
