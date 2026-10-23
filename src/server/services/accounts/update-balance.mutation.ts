/**
 * account.updateBalance (MONEY-MOVES §4.6, D3): today's balance as typed,
 * with its Not logged leg; a new rate type is a dated switch from today.
 * Undo (account.revertBalanceUpdate) puts today's balance and type back.
 */
import { TRPCError } from "@trpc/server";
import { isValidRate, USD } from "~/lib/money";
import { dec } from "~/server/services/envelope/units";
import type { MoneyMutation } from "~/server/services/preview/types";
import { WealthService } from "~/server/services/wealth.service";
import type { Prisma } from "~prisma";
import { type Checkpoint, writeCheckpoint } from "./checkpoint";
import { moveDay } from "./dates";
import { homeCurrencyOf, lockOpenAccount } from "./ledger";
import { balanceEffect, cappedCounted } from "./places";
import {
	type RateTypeSwitch,
	revertRateTypeIn,
	switchRateType,
} from "./rate-type.mutation";

type Tx = Prisma.TransactionClient;

export const BALANCE_FIGURES = [
	"netWorth",
	"accounts.balance",
	"netWorthChange.notLogged",
	"netWorthChange.revaluation",
];

export interface UpdateBalanceInput {
	readonly accountId: string;
	/** The balance as typed: what you hold, or what you owe on a liability. */
	readonly balance: string;
	/** A new rate type switches it from today (D3). */
	readonly rateType?: string | null;
	/** The rate as typed, for the custom type. */
	readonly exchangeRate?: number | null;
	readonly timeZone?: string;
}

export interface BalanceUpdate extends Checkpoint {
	readonly rateSwitch: RateTypeSwitch | null;
	/** The account's stored rate before the update, which the undo puts back. */
	readonly previousRate: string | null;
}

export async function updateBalanceIn(
	tx: Tx,
	userId: string,
	input: UpdateBalanceInput,
): Promise<BalanceUpdate> {
	const account = await lockOpenAccount(tx, userId, input.accountId);
	// The user's day, like every leg (accounts/dates.ts), so a checkpoint and
	// a move made the same morning share a day.
	const today = moveDay(null, new Date(), input.timeZone);
	// Today's rate of the account's (new) type; a custom rate stays as typed.
	const wanted =
		input.rateType !== undefined ? input.rateType : account.exchangeRateType;
	const resolved = await new WealthService(tx).resolveExchangeRate(
		account.currency,
		today,
		{
			rate:
				input.exchangeRate ??
				(account.exchangeRate ? Number(account.exchangeRate) : null),
			type: wanted,
		},
	);
	// A USD account has no rate of its own; its type values the home side (D3).
	const rate =
		account.currency === USD ? { ...resolved, rateType: wanted } : resolved;
	// The switch records the type the account ends up with, which is the
	// resolved one (a type with no rate today falls back), never the request.
	const rateSwitch =
		rate.rateType !== account.exchangeRateType
			? await switchRateType(tx, userId, {
					accountId: account.id,
					rateType: rate.rateType,
					from: today.toISOString().slice(0, 10),
					timeZone: input.timeZone,
				})
			: null;
	const checkpoint = await writeCheckpoint(
		tx,
		userId,
		{ ...account, exchangeRateType: rate.rateType },
		{
			balance: dec(input.balance),
			rate,
			date: today,
			homeCurrency: await homeCurrencyOf(tx, userId),
		},
	);
	return {
		...checkpoint,
		rateSwitch,
		previousRate: account.exchangeRate?.toString() ?? null,
	};
}

export const updateBalance: MoneyMutation<UpdateBalanceInput, BalanceUpdate> = {
	id: "account.updateBalance",
	touches: BALANCE_FIGURES,
	scope: (input) => ({ accountId: input.accountId }),
	run: async (tx, input, actor) => {
		const value = await updateBalanceIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "account.revertBalanceUpdate",
				rows: [
					{ table: "asset_account", id: value.change.accountId },
					...(value.legId ? [{ table: "account_leg", id: value.legId }] : []),
					...(value.rateSwitch
						? [{ table: "asset_rate_type", id: value.rateSwitch.rateTypeId }]
						: []),
				],
			},
		};
	},
};

export interface RevertBalanceUpdateInput {
	readonly accountId: string;
	readonly legId: string | null;
	readonly rateTypeId: string | null;
	/** The update's previousRate; omitted keeps the stored rate. */
	readonly previousRate?: string | null;
	readonly timeZone?: string;
}

/** A snapshot's USD value at a stored rate; a missing rate is never 1. */
function usdAt(
	service: WealthService,
	balance: number,
	currency: string,
	rate: { toString(): string } | null,
): number {
	if (currency === USD) return balance;
	const value = rate === null ? null : Number(rate.toString());
	if (!isValidRate(value)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `No exchange rate for ${currency}. Update the balance again.`,
		});
	}
	return service.calculateBalanceInUSD(balance, value, currency);
}

/** Takes back today's Not logged leg and rate switch. An earlier day's update stays: update the balance again instead. */
export async function revertBalanceUpdateIn(
	tx: Tx,
	userId: string,
	input: RevertBalanceUpdateInput,
) {
	const account = await lockOpenAccount(tx, userId, input.accountId);
	const today = moveDay(null, new Date(), input.timeZone);
	let balance = dec(account.balance.toString());
	if (input.legId) {
		const leg = await tx.accountLeg.findFirst({
			where: {
				id: input.legId,
				accountId: account.id,
				source: "BALANCE_UPDATE",
			},
		});
		if (!leg || leg.date.getTime() !== today.getTime()) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"Only today's balance update can be undone. Update the balance again.",
			});
		}
		balance = balance.sub(
			balanceEffect(account.type, dec(leg.amount.toString())),
		);
		await tx.accountLeg.delete({ where: { id: leg.id } });
	}
	if (input.rateTypeId)
		await revertRateTypeIn(tx, userId, { rateTypeId: input.rateTypeId });
	const reverted = await tx.assetAccount.update({
		where: { id: account.id },
		data: {
			balance: balance.toString(),
			countedUnits: cappedCounted(
				account.type,
				dec(account.countedUnits.toString()),
				balance,
			).toString(),
			...(input.previousRate !== undefined
				? { exchangeRate: input.previousRate }
				: {}),
		},
	});
	const service = new WealthService(tx);
	await service.recordAssetSnapshot(
		tx,
		account.id,
		today,
		balance.toNumber(),
		usdAt(service, balance.toNumber(), account.currency, reverted.exchangeRate),
		userId,
		{
			currency: account.currency,
			type: account.type,
			exchangeRateType: reverted.exchangeRateType,
		},
	);
	return { accountId: account.id, balance: balance.toString() };
}

export const revertBalanceUpdate: MoneyMutation<
	RevertBalanceUpdateInput,
	{ readonly accountId: string; readonly balance: string }
> = {
	id: "account.revertBalanceUpdate",
	touches: BALANCE_FIGURES,
	scope: (input) => ({ accountId: input.accountId }),
	run: async (tx, input, actor) => {
		const value = await revertBalanceUpdateIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "account.updateBalance",
				rows: [{ table: "asset_account", id: value.accountId }],
			},
		};
	},
};
