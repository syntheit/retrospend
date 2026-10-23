/**
 * account.setRateType (D3): an account is valued at one rate type at a time,
 * switched from a day on. The switch is dated: earlier days keep the type
 * they had, so it shows as a revaluation on its day and never restates the
 * past. Undo (account.revertRateType) removes the switch.
 */
import { TRPCError } from "@trpc/server";
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

/**
 * The account's switches in force order: by day, then by when each was
 * written (a second switch on the same day replaces the first from then on).
 * Each row's previousType is the type the row before it set, and the first
 * row's is the type the account had before any switch, so removing any one
 * row leaves the others exact.
 */
function switchesOf(tx: Tx, accountId: string) {
	return tx.assetRateType.findMany({
		where: { accountId },
		orderBy: [{ from: "asc" }, { createdAt: "asc" }],
	});
}

/** Writes the dated switch and, when it is the latest, the account's type. */
export async function switchRateType(
	tx: Tx,
	userId: string,
	input: SetRateTypeInput,
): Promise<RateTypeSwitch> {
	const account = await lockOpenAccount(tx, userId, input.accountId);
	const from = moveDay(input.from, new Date(), input.timeZone);
	const day = dayOf(from);
	const before = await valueOnDay(tx, userId, account.id, day);
	const rows = await switchesOf(tx, account.id);
	const base = rows[0] ? rows[0].previousType : account.exchangeRateType;
	const earlier = rows.filter((r) => r.from <= from).at(-1);
	const next = rows.find((r) => r.from > from);
	const row = await tx.assetRateType.create({
		data: {
			userId,
			accountId: account.id,
			from,
			type: input.rateType,
			previousType: earlier ? earlier.type : base,
			createdAt: new Date(),
		},
	});
	if (next) {
		await tx.assetRateType.update({
			where: { id: next.id },
			data: { previousType: input.rateType },
		});
	} else {
		// moveDay never returns a future day, so the latest switch is in force today.
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

/** Removes one switch; the account goes back to the type it had before it when the switch was the latest. */
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
	const rows = await switchesOf(tx, account.id);
	const next = rows[rows.findIndex((r) => r.id === row.id) + 1];
	// Only this switch goes: the one after it now replaces what this one did.
	if (next) {
		await tx.assetRateType.update({
			where: { id: next.id },
			data: { previousType: row.previousType },
		});
	}
	await tx.assetRateType.delete({ where: { id: row.id } });
	const latest = rows.filter((r) => r.id !== row.id).at(-1);
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
