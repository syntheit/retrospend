/**
 * income.moveIn (MONEY-MOVES §2.2 "Move in", README D4): count Wealth money
 * in the budget without selling it. No account moves (I16): the dollars stay
 * in Wise. The budget gets the kept income's booked value (one value per
 * transaction, I20), or today's value of the units for Wealth money that is
 * not tied to an income. The units are marked as counted on the account so
 * a later sale never counts them a second time. A kept income's units are
 * marked on its leg (the trigger counts them on the account), capped at
 * what the account still holds outside the budget, so deleting the income
 * takes its counted units with it.
 *
 * Undo is income.undoMoveIn with the same input.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { TRPCError } from "@trpc/server";
import type { Money } from "~/server/figures/registry";
import { dec, toMinor } from "~/server/services/envelope/units";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma } from "~prisma";
import { moveDay, rowDateOf } from "../accounts/dates";
import {
	bookHome,
	homeCurrencyOf,
	lockOpenAccount,
	ratePickFor,
} from "../accounts/ledger";
import { inBudget, worthOf } from "../accounts/places";
import {
	type BudgetSideResult,
	recordBudgetSide,
} from "../transfers/budget-side";
import { incomeRow } from "./delete.mutation";

type Tx = Prisma.TransactionClient;

/** Moves no account and changes no net worth: these are what a preview must show unchanged. */
export const MOVE_IN_FIGURES = ["netWorth", "accounts.balance", "notTracked"];

export type MoveInInput =
	| {
			/** A kept income: its booked value enters the budget. */
			readonly expenseId: string;
			readonly putIn?: string | null;
			readonly date?: string | null;
			readonly timeZone?: string;
	  }
	| {
			/** Wealth money not tied to an income: these units at today's value. */
			readonly accountId: string;
			readonly units: string;
			readonly putIn?: string | null;
			readonly date?: string | null;
			readonly timeZone?: string;
	  };

export interface MovedIn {
	readonly accountId: string;
	readonly expenseId: string | null;
	/** The amount the budget counts, in the home currency. */
	readonly amount: Money;
	readonly countedUnits: string;
	readonly budgetSide: BudgetSideResult;
}

interface Side {
	readonly accountId: string;
	readonly units: Decimal;
	readonly home: Decimal;
	/** The kept income's leg, when the units are an income's. */
	readonly legId: string | null;
}

/** The part of a leg's booked value that `units` of it carry. */
const homeOfPart = (
	leg: { amount: { toString(): string }; homeAmount: { toString(): string } },
	units: Decimal,
) =>
	dec(leg.homeAmount.toString())
		.mul(units)
		.div(leg.amount.toString())
		.toDecimalPlaces(8);

async function incomeSide(
	tx: Tx,
	userId: string,
	expenseId: string,
): Promise<Side> {
	const row = await incomeRow(tx, userId, expenseId);
	if (!row.keepInWealth) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This income is already in your budget",
		});
	}
	if (row.movedInAt) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This income was moved in already",
		});
	}
	const leg = await tx.accountLeg.findFirst({
		where: { expenseId, source: "INCOME", accountId: { not: null } },
	});
	if (!leg?.accountId || leg.homeAmount === null) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This income has no account to move from",
		});
	}
	// Some of it may have left the account since: count only what is still there.
	const account = await lockOpenAccount(tx, userId, leg.accountId);
	const free = worthOf(account.type, dec(account.balance.toString())).sub(
		account.countedUnits.toString(),
	);
	const amount = dec(leg.amount.toString());
	const units = amount.lt(free) ? amount : free;
	if (!units.gt(0)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "None of this income is left in the account outside your budget",
		});
	}
	return {
		accountId: leg.accountId,
		units,
		home: homeOfPart({ amount, homeAmount: leg.homeAmount }, units),
		legId: leg.id,
	};
}

async function accountSide(
	tx: Tx,
	userId: string,
	accountId: string,
	unitsText: string,
	date: Date,
) {
	const account = await lockOpenAccount(tx, userId, accountId);
	const home = await homeCurrencyOf(tx, userId);
	const units = dec(unitsText);
	const free = worthOf(account.type, dec(account.balance.toString())).sub(
		account.countedUnits.toString(),
	);
	if (!units.gt(0) || units.gt(free)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "That is more than this account holds outside your budget",
		});
	}
	const pick = await ratePickFor(tx, [home, account.currency]);
	const value = bookHome(
		pick,
		{ currency: account.currency, account },
		units,
		home,
		date,
	);
	if (!value) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `No exchange rate for ${account.currency}`,
		});
	}
	return { accountId, units, home: value.amount, legId: null };
}

export async function moveInIn(
	tx: Tx,
	userId: string,
	input: MoveInInput,
): Promise<MovedIn> {
	const date = moveDay(input.date, new Date(), input.timeZone);
	const homeCurrency = await homeCurrencyOf(tx, userId);
	const side: Side =
		"expenseId" in input
			? await incomeSide(tx, userId, input.expenseId)
			: await accountSide(tx, userId, input.accountId, input.units, date);
	const account = await lockOpenAccount(tx, userId, side.accountId);
	if (inBudget(account, homeCurrency)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This account is already part of your budget",
		});
	}
	await markCounted(tx, side, true);
	const expenseId = "expenseId" in input ? input.expenseId : null;
	if (expenseId)
		await tx.expense.update({
			where: { id: expenseId },
			// A moment on the expense row, read in the viewer's zone like its date.
			data: { movedInAt: rowDateOf(date, input.timeZone) },
		});
	const amount = {
		minor: toMinor(side.home, homeCurrency),
		currency: homeCurrency,
	};
	const budgetSide = await recordBudgetSide(tx, {
		userId,
		direction: "FROM_WEALTH",
		amount,
		envelopeId: input.putIn ?? null,
		date,
		transferId: null,
		countOnly: true,
		sourceExpenseId: expenseId,
		assetAccountId: account.id,
	});
	return {
		accountId: account.id,
		expenseId,
		amount,
		countedUnits: side.units.toString(),
		budgetSide,
	};
}

/** Counts the side's units (or takes them back): on the income's leg when there is one (the trigger follows), else on the account itself. */
async function markCounted(tx: Tx, side: Side, counted: boolean) {
	if (side.legId) {
		await tx.accountLeg.update({
			where: { id: side.legId },
			data: { countedUnits: counted ? side.units.toString() : "0" },
		});
		return;
	}
	const by = side.units.toString();
	await tx.assetAccount.update({
		where: { id: side.accountId },
		data: {
			countedUnits: counted ? { increment: by } : { decrement: by },
		},
	});
}

/** The units a Move in of this income counted, from its leg. */
async function movedInSide(
	tx: Tx,
	userId: string,
	expenseId: string,
): Promise<Side> {
	const row = await incomeRow(tx, userId, expenseId);
	if (!row.movedInAt) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This income was not moved in",
		});
	}
	const leg = await tx.accountLeg.findFirst({
		where: { expenseId: row.id, source: "INCOME", accountId: { not: null } },
	});
	if (!leg?.accountId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This income has no account",
		});
	}
	const units = dec(leg.countedUnits.toString());
	return {
		accountId: leg.accountId,
		units,
		home:
			leg.homeAmount === null
				? dec(0)
				: homeOfPart({ amount: leg.amount, homeAmount: leg.homeAmount }, units),
		legId: leg.id,
	};
}

export async function undoMoveInIn(
	tx: Tx,
	userId: string,
	input: MoveInInput,
): Promise<MovedIn> {
	const side: Side =
		"expenseId" in input
			? await movedInSide(tx, userId, input.expenseId)
			: {
					accountId: input.accountId,
					units: dec(input.units),
					home: dec(0),
					legId: null,
				};
	const account = await lockOpenAccount(tx, userId, side.accountId);
	if (dec(account.countedUnits.toString()).lt(side.units)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Some of this money has left the account since. Move it out of your budget instead.",
		});
	}
	await markCounted(tx, side, false);
	const expenseId = "expenseId" in input ? input.expenseId : null;
	if (expenseId)
		await tx.expense.update({
			where: { id: expenseId },
			data: { movedInAt: null },
		});
	const home = await homeCurrencyOf(tx, userId);
	return {
		accountId: account.id,
		expenseId,
		amount: { minor: -toMinor(side.home, home), currency: home },
		countedUnits: side.units.neg().toString(),
		budgetSide: { recorded: false, reason: "no_envelope_budget" },
	};
}

export const moveIn: MoneyMutation<MoveInInput, MovedIn> = {
	id: "income.moveIn",
	touches: MOVE_IN_FIGURES,
	run: async (tx, input, actor) => {
		const value = await moveInIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "income.undoMoveIn",
				rows: [
					{ table: "asset_account", id: value.accountId },
					...(value.expenseId
						? [{ table: "expense", id: value.expenseId }]
						: []),
				],
			},
		};
	},
};

export const undoMoveIn: MoneyMutation<MoveInInput, MovedIn> = {
	id: "income.undoMoveIn",
	touches: MOVE_IN_FIGURES,
	run: async (tx, input, actor) => {
		const value = await undoMoveInIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "income.moveIn",
				rows: [{ table: "asset_account", id: value.accountId }],
			},
		};
	},
};
