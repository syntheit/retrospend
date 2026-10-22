/**
 * account.setRateType (D3): an account is valued at one rate type at a time,
 * switched from a day on. The switch is dated: earlier days keep the type
 * they had, so it shows as a revaluation on its day and never restates the
 * past. Undo (account.revertRateType) removes the switch.
 */
import { TRPCError } from "@trpc/server";
import { normalizeDate } from "~/lib/date";
import type { Money } from "~/server/figures/registry";
import { toMinor } from "~/server/services/envelope/units";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma } from "~prisma";
import { moveDay } from "./dates";
import { lockOpenAccount } from "./ledger";
import { loadAccountsLedger } from "./load";
import { dayOf, valueOn } from "./series";

type Tx = Prisma.TransactionClient;

export const RATE_TYPE_FIGURES = [
	"netWorth",
	"netWorthChange.revaluation",
	"accounts.balance",
];

export interface SetRateTypeInput {
	readonly accountId: string;
	/** official, blue, mep, card...; null = the default pick. */
	readonly rateType: string | null;
	/** YYYY-MM-DD the type applies from; today when omitted. */
	readonly from?: string | null;
	readonly timeZone?: string;
}

export interface RateTypeSwitch {
	readonly rateTypeId: string;
	readonly from: string;
	readonly rateType: string | null;
	/** The type days before `from` keep. */
	readonly earlier: string | null;
	/** What the switch did to the account's value on its day; null when a rate is missing. */
	readonly revaluation: Money | null;
}

async function valueOnDay(
	tx: Tx,
	userId: string,
	accountId: string,
	day: string,
) {
	const ledger = await loadAccountsLedger(tx, userId);
	const history = ledger.histories.find((h) => h.account.id === accountId);
	const value =
		history && valueOn(history, day, ledger.homeCurrency, ledger.pick);
	return value ? { value, home: ledger.homeCurrency } : null;
}

/** Writes the dated switch and, when it is in force today, the account's type. */
export async function switchRateType(
	tx: Tx,
	userId: string,
	input: SetRateTypeInput,
): Promise<RateTypeSwitch> {
	const account = await lockOpenAccount(tx, userId, input.accountId);
	const from = moveDay(input.from, new Date(), input.timeZone);
	const day = dayOf(from);
	const before = await valueOnDay(tx, userId, account.id, day);
	const later = await tx.assetRateType.findFirst({
		where: { accountId: account.id, from: { gt: from } },
		select: { id: true },
	});
	const row = await tx.assetRateType.upsert({
		where: { accountId_from: { accountId: account.id, from } },
		create: {
			userId,
			accountId: account.id,
			from,
			type: input.rateType,
			previousType: account.exchangeRateType,
		},
		update: { type: input.rateType },
	});
	if (!later && from <= normalizeDate(new Date())) {
		await tx.assetAccount.update({
			where: { id: account.id },
			data: { exchangeRateType: input.rateType },
		});
	}
	const after = await valueOnDay(tx, userId, account.id, day);
	return {
		rateTypeId: row.id,
		from: day,
		rateType: input.rateType,
		earlier: row.previousType,
		revaluation:
			before && after
				? {
						minor: toMinor(after.value.sub(before.value), after.home),
						currency: after.home,
					}
				: null,
	};
}

export const setRateType: MoneyMutation<SetRateTypeInput, RateTypeSwitch> = {
	id: "account.setRateType",
	touches: RATE_TYPE_FIGURES,
	scope: (input) => ({ accountId: input.accountId }),
	run: async (tx, input, actor) => {
		const value = await switchRateType(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "account.revertRateType",
				rows: [{ table: "asset_rate_type", id: value.rateTypeId }],
			},
		};
	},
};

export interface RevertRateTypeInput {
	readonly rateTypeId: string;
}

/** Removes a switch; the account goes back to the type it had before it when the switch was the latest. */
export async function revertRateTypeIn(
	tx: Tx,
	userId: string,
	input: RevertRateTypeInput,
): Promise<{ readonly accountId: string; readonly rateType: string | null }> {
	const row = await tx.assetRateType.findFirst({
		where: { id: input.rateTypeId, userId },
	});
	if (!row) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Rate type change not found",
		});
	}
	const account = await lockOpenAccount(tx, userId, row.accountId);
	await tx.assetRateType.delete({ where: { id: row.id } });
	const latest = await tx.assetRateType.findFirst({
		where: { accountId: account.id, from: { lte: normalizeDate(new Date()) } },
		orderBy: { from: "desc" },
	});
	const rateType = latest ? latest.type : row.previousType;
	await tx.assetAccount.update({
		where: { id: account.id },
		data: { exchangeRateType: rateType },
	});
	return { accountId: account.id, rateType };
}

export const revertRateType: MoneyMutation<
	RevertRateTypeInput,
	{ readonly accountId: string; readonly rateType: string | null }
> = {
	id: "account.revertRateType",
	touches: RATE_TYPE_FIGURES,
	run: async (tx, input, actor) => {
		const value = await revertRateTypeIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "account.setRateType",
				rows: [{ table: "asset_account", id: value.accountId }],
			},
		};
	},
};
