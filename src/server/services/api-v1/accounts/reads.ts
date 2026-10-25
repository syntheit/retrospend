import { userTransaction } from "~/server/db-tx";
import {
	defaultAccounts,
	setDefaultAccount,
} from "~/server/services/accounts/defaults";
import { exportAccountsCsv } from "~/server/services/accounts/manage";
import type { Caller } from "../caller";
import { wire } from "../wire";
import { accountDetailIn, accountItemsIn } from "./items";
import { netWorthIn } from "./net-worth";

/** v1 adapters for the account reads and the default-account prefill. */

const run = <T>(
	caller: Caller,
	work: Parameters<typeof userTransaction<T>>[2],
) => userTransaction(caller.db, caller.principal.userId, work);

export const accountReads = {
	list: (caller: Caller) =>
		run(caller, (tx) => accountItemsIn(tx, caller.principal.userId)),
	get: (caller: Caller, input: { id: string }) =>
		run(caller, async (tx) =>
			wire(await accountDetailIn(tx, caller.principal.userId, input.id)),
		),
	netWorth: (caller: Caller, input: { days: number; changeDays: number }) =>
		run(caller, (tx) => netWorthIn(tx, caller.principal.userId, input)),
	defaults: async (caller: Caller) => ({
		defaults: await defaultAccounts(caller.db, caller.principal.userId),
	}),
	export: (caller: Caller) =>
		exportAccountsCsv(caller.db, caller.principal.userId),
	setDefault: async (
		caller: Caller,
		input: { currency: string; accountId: string | null },
	) => ({
		defaults: await setDefaultAccount(
			caller.db,
			caller.principal.userId,
			input.currency,
			input.accountId,
		),
	}),
};
