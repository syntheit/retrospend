import type { MoneyMutation } from "~/server/services/preview/types";
import {
	type AnyMutation,
	createMoneyOp,
	createUndoer,
	type LedgerCaller,
	type UndoPlan,
} from "../money-op";
import {
	type BalanceBody,
	type RateTypeBody,
	revertBalanceMutation,
	revertRateType,
	setRateTypeMutation,
	updateBalanceMutation,
} from "./balance";
import {
	closeAccountMutation,
	createAccountMutation,
	deleteAccountMutation,
	reopenAccountMutation,
	updateAccountMutation,
} from "./mutations";

/** The inverse calls an account undo token can name (the `kind` of the undo answer). */
export type AccountOp =
	| "account.delete"
	| "account.restore"
	| "account.close"
	| "account.reopen"
	| "balance.revert"
	| "rate_type.revert";

type Plan = UndoPlan<AccountOp>;
/** What the route takes: the mutation's input without the zone the caller supplies. */
type WithoutZone<M extends { run: (...args: never[]) => unknown }> = Omit<
	Parameters<M["run"]>[1],
	"timeZone"
>;
const moneyOp = createMoneyOp<AccountOp, LedgerCaller>("account");

const watch = (id: string) => ({ table: "account", id }) as const;

/** The restore: the edit's own mutation, answering the account it put back. */
const restoreAccountMutation: MoneyMutation<
	Parameters<typeof updateAccountMutation.run>[1],
	Awaited<ReturnType<typeof updateAccountMutation.run>>["value"]["item"]
> = {
	...updateAccountMutation,
	run: async (tx, input, actor) => {
		const done = await updateAccountMutation.run(tx, input, actor);
		return { value: done.value.item, undo: done.undo };
	},
};

/**
 * Every account money write: the web's mutation and how to take it back.
 * Create is undone by deleting the new account while nothing has been
 * written against it; an edit by editing it back; close and reopen by each
 * other; Update balance and the rate type switch by their own reverts.
 * Deleting an account cannot be taken back.
 */
export const accountOps = {
	create: moneyOp(createAccountMutation, {
		prep: (caller, input: WithoutZone<typeof createAccountMutation>) => ({
			...input,
			timeZone: caller.timeZone,
		}),
		plan: (_i, v): Plan => ({
			op: "account.delete",
			args: { id: v.id },
			guard: watch(v.id),
		}),
	}),
	update: moneyOp(updateAccountMutation, {
		prep: (caller, input: WithoutZone<typeof updateAccountMutation>) => ({
			...input,
			timeZone: caller.timeZone,
		}),
		present: (v) => v.item,
		plan: (i, v): Plan | null =>
			v.previous
				? {
						op: "account.restore",
						args: { ...v.previous, timeZone: i.timeZone },
						guard: watch(i.id),
					}
				: null,
	}),
	close: moneyOp(closeAccountMutation, {
		plan: (i): Plan => ({
			op: "account.reopen",
			args: { id: i.id },
			guard: watch(i.id),
		}),
	}),
	reopen: moneyOp(reopenAccountMutation, {
		plan: (i): Plan => ({
			op: "account.close",
			args: { id: i.id },
			guard: watch(i.id),
		}),
	}),
	delete: moneyOp(deleteAccountMutation),
	updateBalance: moneyOp(updateBalanceMutation, {
		prep: (caller, input: Omit<BalanceBody, "timeZone">): BalanceBody => ({
			...input,
			timeZone: caller.timeZone,
		}),
		plan: (i, v): Plan => ({
			op: "balance.revert",
			args: {
				accountId: i.id,
				legId: v.legId,
				rateTypeId: v.rateSwitch?.rateTypeId ?? null,
				previousRate: v.previousRate,
				timeZone: i.timeZone,
			},
			guard: watch(i.id),
		}),
	}),
	setRateType: moneyOp(setRateTypeMutation, {
		prep: (caller, input: Omit<RateTypeBody, "timeZone">): RateTypeBody => ({
			...input,
			timeZone: caller.timeZone,
		}),
		plan: (i, v): Plan => ({
			op: "rate_type.revert",
			args: { rateTypeId: v.rateTypeId },
			guard: watch(i.id),
		}),
	}),
};

const INVERSES: Record<AccountOp, AnyMutation> = {
	"account.delete": deleteAccountMutation,
	"account.restore": restoreAccountMutation,
	"account.close": closeAccountMutation,
	"account.reopen": reopenAccountMutation,
	"balance.revert": revertBalanceMutation,
	"rate_type.revert": revertRateType,
};

const undoer = createUndoer<AccountOp, LedgerCaller>("account", INVERSES);

export const undoAccountWrite = (caller: LedgerCaller, token: string) =>
	undoer.undo(caller, token);

export const previewUndoAccountWrite = (caller: LedgerCaller, token: string) =>
	undoer.preview(caller, token);
