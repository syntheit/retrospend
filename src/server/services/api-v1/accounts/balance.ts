import { TRPCError } from "@trpc/server";
import {
	type RateTypeSwitch,
	revertRateType,
	setRateType,
} from "~/server/services/accounts/rate-type.mutation";
import {
	revertBalanceUpdate,
	updateBalance,
} from "~/server/services/accounts/update-balance.mutation";
import type { MoneyMutation } from "~/server/services/preview/types";
import { assertMinorUnits } from "../amounts";
import { moneyOfText } from "../money-write";
import { exactRate } from "./mutations";

/**
 * Update balance and the rate type switch as the routes answer them. The
 * mutations are the web's own (accounts/*.mutation.ts); these only read the
 * account's currency to check the typed amount and shape the answer.
 */

type Tx = Parameters<typeof updateBalance.run>[0];

async function currencyOf(tx: Tx, userId: string, accountId: string) {
	const account = await tx.assetAccount.findFirst({
		where: { id: accountId, userId },
		select: { currency: true },
	});
	if (!account)
		throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
	return account.currency;
}

export type BalanceBody = {
	id: string;
	balance: string;
	rateType?: string | null;
	exchangeRate?: string | null;
	timeZone: string;
};

export const updateBalanceMutation: MoneyMutation<
	BalanceBody,
	{
		accountId: string;
		name: string;
		before: ReturnType<typeof moneyOfText>;
		after: ReturnType<typeof moneyOfText>;
		notLogged: ReturnType<typeof moneyOfText>;
		rateSwitch: RateTypeSwitch | null;
		legId: string | null;
		previousRate: string | null;
	}
> = {
	id: "account.updateBalance",
	touches: updateBalance.touches,
	scope: (input) => ({ accountId: input.id }),
	run: async (tx, input, actor) => {
		const currency = await currencyOf(tx, actor.userId, input.id);
		assertMinorUnits(input.balance, currency, "balance");
		const done = await updateBalance.run(
			tx,
			{
				accountId: input.id,
				balance: input.balance,
				rateType: input.rateType,
				exchangeRate: input.exchangeRate
					? exactRate(input.exchangeRate, "exchangeRate")
					: null,
				timeZone: input.timeZone,
			},
			actor,
		);
		const v = done.value;
		return {
			value: {
				accountId: v.change.accountId,
				name: v.change.name,
				before: moneyOfText(v.change.before, currency),
				after: moneyOfText(v.change.after, currency),
				notLogged: moneyOfText(v.notLogged, currency),
				rateSwitch: v.rateSwitch,
				legId: v.legId,
				previousRate: v.previousRate,
			},
			undo: done.undo,
		};
	},
};

export type RevertBalanceBody = {
	accountId: string;
	legId: string | null;
	rateTypeId: string | null;
	previousRate: string | null;
	timeZone: string;
};

export const revertBalanceMutation: MoneyMutation<
	RevertBalanceBody,
	{ accountId: string; balance: ReturnType<typeof moneyOfText> }
> = {
	id: revertBalanceUpdate.id,
	touches: revertBalanceUpdate.touches,
	scope: revertBalanceUpdate.scope,
	run: async (tx, input, actor) => {
		// Only today's update can be taken back; an older one is the state having moved on.
		const done = await revertBalanceUpdate.run(tx, input, actor).catch((e) => {
			if (e instanceof TRPCError && e.code === "BAD_REQUEST")
				throw new TRPCError({
					code: "CONFLICT",
					message: e.message,
					cause: e,
				});
			throw e;
		});
		const currency = await currencyOf(tx, actor.userId, input.accountId);
		return {
			value: {
				accountId: done.value.accountId,
				balance: moneyOfText(done.value.balance, currency),
			},
			undo: done.undo,
		};
	},
};

export type RateTypeBody = {
	id: string;
	rateType: string | null;
	from?: string | null;
	timeZone: string;
};

export const setRateTypeMutation: MoneyMutation<RateTypeBody, RateTypeSwitch> =
	{
		id: setRateType.id,
		touches: setRateType.touches,
		scope: (input) => ({ accountId: input.id }),
		run: (tx, input, actor) =>
			setRateType.run(
				tx,
				{
					accountId: input.id,
					rateType: input.rateType,
					from: input.from,
					timeZone: input.timeZone,
				},
				actor,
			),
	};

export { revertRateType };
