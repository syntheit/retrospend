/**
 * Personal expense edits as money mutations (R30, R15): the Add expense
 * sheet previews the same update or delete it saves, and each returns the
 * input that puts the expense back, so the toast's Undo is one more call.
 *
 * - expense.update: ExpenseService.editExpense on the preview's
 *   transaction; its undo is another expense.update with the values it had.
 * - expense.delete: the row and its spread parts go; its undo is
 *   expense.restore, which puts the stored rows back verbatim from a signed
 *   snapshot (expense-snapshot.ts): nothing is booked again.
 *
 * An edit's undo carries the rate it had (a custom rate as the same cross
 * rate, a table type as that type, an untouched rate as both saved legs) and
 * the figures it was saved with, signed (restore-token.ts) so a client can
 * carry them but never write its own, which the undo writes back as they
 * were: booking again could land a cent apart (a row booked half up, a home
 * amount from the 12-decimal rate).
 */

import type {
	SavedFigures,
	StoredExpense,
} from "@retrospend/domain/expense-write/edit";
import { ENTRY_POLICY } from "@retrospend/domain/expense-write/policy";
import { rateInputOf } from "@retrospend/domain/expense-write/put-body";
import {
	bookedInOtherHome,
	otherHomeMessage,
} from "@retrospend/domain/expense-write/refusals";
import { dec } from "@retrospend/domain/precise-decimal";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { homeCurrencyOf } from "../accounts/ledger";
import {
	EXPENSE_RESTORE,
	ExpenseService,
	type UpdateExpenseInput,
} from "../expense.service";
import { GLANCE_SPENT } from "../figures/spend-pace";
import type { MoneyMutation } from "../preview/types";
import {
	type ExpenseSnapshot,
	restoreExpense,
	snapshotExpense,
} from "./expense-snapshot";
import {
	type RestoreToken,
	type RowRestore,
	readRestore,
	signRestore,
} from "./restore-token";

type Tx = Prisma.TransactionClient;

export const EXPENSE_FIGURES = ["spent", GLANCE_SPENT];

/** The kind of signed token expense.delete returns for its undo. */
const EXPENSE_DELETE = "expense.delete";

export type { UpdateExpenseInput };

/** The fields the form saves, as `row` holds them now, and its figures signed. */
function fieldsOf(
	row: StoredExpense,
	parts: number,
	userId: string,
	home: string,
) {
	const amount = dec(row.amount).toFixed();
	return {
		title: row.title,
		// Decimal text: every stored digit comes back.
		amount,
		currency: row.currency,
		date: row.date,
		location: row.location ?? undefined,
		description: row.description ?? undefined,
		categoryId: row.categoryId ?? undefined,
		amortizeOver: row.isAmortizedParent ? parts : undefined,
		excludeFromAnalytics: row.excludeFromAnalytics,
		...rateInputOf(row),
		restore: signRestore(EXPENSE_RESTORE, userId, {
			id: row.id,
			amount,
			currency: row.currency,
			date: row.date.toISOString(),
			home,
			bound: {},
			figures: figuresOf(row),
		} satisfies RowRestore<SavedFigures>),
	};
}

/** The booked figures as stored, as plain decimal text. */
function figuresOf(row: StoredExpense): SavedFigures {
	return {
		exchangeRate: row.exchangeRate,
		amountInUSD: row.amountInUSD,
		rateType: row.rateType,
		homeCurrency: row.homeCurrency,
		homeRate: row.homeRate,
		homeAmount: row.homeAmount,
	};
}

/**
 * A typed rate pinned to the home it was booked into (an edit's undo) is
 * refused once the home changed: it would read as a rate into the new home.
 */
async function refuseOtherHome(
	tx: Tx,
	userId: string,
	home: string | undefined,
) {
	if (!home) return;
	const user = await tx.user.findUnique({
		where: { id: userId },
		select: { homeCurrency: true },
	});
	if (!bookedInOtherHome(home, user?.homeCurrency ?? "")) return;
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: otherHomeMessage(home),
	});
}

export interface UpdatedExpense {
	readonly id: string;
	/** expense.update with this input puts the expense back. */
	readonly restore: UpdateExpenseInput;
}

/**
 * `categoryFirst` is v1's read order on a replace: a bad category answers
 * before a missing row. The undo and the web's own edit read the row first.
 */
function updateExpenseMutation(options: {
	categoryFirst?: boolean;
}): MoneyMutation<UpdateExpenseInput, UpdatedExpense> {
	return {
		id: "expense.update",
		touches: EXPENSE_FIGURES,
		run: async (tx, input, actor) => {
			let parts = 0;
			const { before } = await new ExpenseService(tx).editExpense(
				actor.userId,
				input,
				ENTRY_POLICY,
				{
					...options,
					afterRead: async (row) => {
						await refuseOtherHome(tx, actor.userId, input.customRate?.home);
						if (row.isAmortizedParent)
							parts = await tx.expense.count({
								where: { parentId: row.id, userId: actor.userId },
							});
					},
				},
			);
			const home = await homeCurrencyOf(tx, actor.userId);
			return {
				value: {
					id: input.id,
					restore: {
						id: input.id,
						...fieldsOf(before, parts, actor.userId, home),
					},
				},
				undo: {
					kind: "revert",
					mutation: "expense.update",
					rows: [{ table: "expense", id: input.id }],
				},
			};
		},
	};
}

export const updateExpenseEntry = updateExpenseMutation({});

/** The v1 replace and its preview twin (api-v1/expenses.ts). */
export const replaceExpenseEntry = updateExpenseMutation({
	categoryFirst: true,
});

export interface DeletedExpense {
	readonly id: string;
	/** expense.restore with this token brings the same rows back, verbatim. */
	readonly restore: RestoreToken;
}

export const deleteExpenseEntry: MoneyMutation<{ id: string }, DeletedExpense> =
	{
		id: "expense.delete",
		touches: EXPENSE_FIGURES,
		run: async (tx, input, actor) => {
			// A read: a refused delete (not found, a fee) writes nothing and drops it.
			const snapshot = await snapshotExpense(tx, actor.userId, input.id);
			await new ExpenseService(tx).deleteExpense(actor.userId, input.id, {
				policy: ENTRY_POLICY,
			});
			return {
				value: {
					id: input.id,
					restore: signRestore(EXPENSE_DELETE, actor.userId, snapshot),
				},
				undo: {
					kind: "revert",
					mutation: "expense.restore",
					rows: [{ table: "expense", id: input.id }],
				},
			};
		},
	};

/** The undo of expense.delete: the signed rows back as they were stored. */
export const restoreExpenseEntry: MoneyMutation<
	{ token: RestoreToken },
	{ id: string }
> = {
	id: "expense.restore",
	touches: EXPENSE_FIGURES,
	run: async (tx, input, actor) => {
		const snapshot = readRestore<ExpenseSnapshot>(
			input.token,
			EXPENSE_DELETE,
			actor.userId,
		);
		const id = await restoreExpense(tx, actor.userId, snapshot);
		return {
			value: { id },
			undo: {
				kind: "revert",
				mutation: "expense.delete",
				rows: [{ table: "expense", id }],
			},
		};
	},
};
