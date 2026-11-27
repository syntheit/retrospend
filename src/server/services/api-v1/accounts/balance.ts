import { balanceFieldsRefusal } from "@retrospend/domain/accounts/refusals";
import { TRPCError } from "@trpc/server";
import { exactRate } from "~/server/services/accounts/exact-rate";
import {
	accountVersionIn,
	type ExpectedAccountState,
} from "~/server/services/accounts/expected-state";
import {
	type RateTypeSwitch,
	revertRateType as revertRateTypeCore,
	setRateType,
} from "~/server/services/accounts/rate-type.mutation";
import {
	revertBalanceUpdate,
	updateBalance,
} from "~/server/services/accounts/update-balance.mutation";
import type { MoneyMutation } from "~/server/services/preview/types";
import { moneyOfText } from "../money-write";

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

export type BalanceBody = ExpectedAccountState & {
	id: string;
	legId?: string;
	rateTypeId?: string;
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
		version: number;
	}
> = {
	id: "account.updateBalance",
	touches: updateBalance.touches,
	scope: (input) => ({ accountId: input.id }),
	run: async (tx, input, actor) => {
		const currency = await currencyOf(tx, actor.userId, input.id);
		const refusal = balanceFieldsRefusal({
			currency,
			balance: input.balance,
			exchangeRate: input.exchangeRate,
		});
		if (refusal !== null)
			throw new TRPCError({ code: "BAD_REQUEST", message: refusal });
		const done = await updateBalance.run(
			tx,
			{
				accountId: input.id,
				balance: input.balance,
				rateType: input.rateType,
				exchangeRate: input.exchangeRate
					? exactRate(input.exchangeRate, "exchangeRate")
					: null,
				legId: input.legId,
				rateTypeId: input.rateTypeId,
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
				version: await accountVersionIn(tx, actor.userId, input.id),
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
	{
		accountId: string;
		balance: ReturnType<typeof moneyOfText>;
		version: number;
	}
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
				version: await accountVersionIn(tx, actor.userId, input.accountId),
			},
			undo: done.undo,
		};
	},
};

export type RateTypeBody = ExpectedAccountState & {
	id: string;
	rateTypeId?: string;
	rateType: string | null;
	from?: string | null;
	timeZone: string;
};

export const setRateTypeMutation: MoneyMutation<
	RateTypeBody,
	RateTypeSwitch & { version: number }
> = {
	id: setRateType.id,
	touches: setRateType.touches,
	scope: (input) => ({ accountId: input.id }),
	run: async (tx, input, actor) => {
		const done = await setRateType.run(
			tx,
			{
				accountId: input.id,
				rateTypeId: input.rateTypeId,
				rateType: input.rateType,
				from: input.from,
				timeZone: input.timeZone,
			},
			actor,
		);
		return {
			value: {
				...done.value,
				version: await accountVersionIn(tx, actor.userId, input.id),
			},
			undo: done.undo,
		};
	},
};

export const revertRateType: MoneyMutation<
	Parameters<typeof revertRateTypeCore.run>[1],
	{ accountId: string; rateType: string | null; version: number }
> = {
	id: revertRateTypeCore.id,
	touches: revertRateTypeCore.touches,
	run: async (tx, input, actor) => {
		const done = await revertRateTypeCore.run(tx, input, actor);
		return {
			value: {
				...done.value,
				version: await accountVersionIn(tx, actor.userId, done.value.accountId),
			},
			undo: done.undo,
		};
	},
};
