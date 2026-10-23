/**
 * Personal expense edits as money mutations (R30, R15): the Add expense
 * sheet previews the same update or delete it saves, and each returns the
 * input that puts the expense back, so the toast's Undo is one more call.
 *
 * - expense.update: ExpenseService.updateExpense on the preview's
 *   transaction; its undo is another expense.update with the values it had.
 * - expense.delete: the row and its spread parts go; its undo is
 *   expense.restore, which puts the stored rows back verbatim from a signed
 *   snapshot (expense-snapshot.ts): nothing is booked again.
 *
 * An edit's undo re-books the rate it had: a custom rate as the same cross
 * rate, a table type as that type on the entry's date (the day's rate does
 * not move), an untouched rate as both of its saved legs.
 */
import { TRPCError } from "@trpc/server";
import { CUSTOM_RATE_TYPE } from "~/lib/rate-selection";
import type { Prisma } from "~prisma";
import { type CreateExpenseInput, ExpenseService } from "../expense.service";
import type { MoneyMutation } from "../preview/types";
import {
	type ExpenseSnapshot,
	restoreExpense,
	snapshotExpense,
} from "./expense-snapshot";
import { type RestoreToken, readRestore, signRestore } from "./restore-token";

type Tx = Prisma.TransactionClient;

export const EXPENSE_FIGURES = ["spent"];

export type UpdateExpenseInput = Parameters<ExpenseService["updateExpense"]>[1];

type ExpenseRow = Prisma.ExpenseGetPayload<{
	include: { children: { select: { id: true } } };
}>;

/** The rate fields that book `row`'s rate again (see the file comment). */
export function rateInputOf(row: {
	currency: string;
	exchangeRate: { toString(): string };
	pricingSource: string;
	rateType: string | null;
	homeRate: { toFixed(): string } | null;
	homeCurrency: string | null;
}): Pick<
	CreateExpenseInput,
	"exchangeRate" | "pricingSource" | "rateType" | "customRate"
> {
	if (row.rateType === CUSTOM_RATE_TYPE && row.homeRate) {
		return {
			customRate: {
				base: row.currency,
				// Plain decimal text (toFixed never writes an exponent), every stored digit.
				value: row.homeRate.toFixed(),
				...(row.homeCurrency ? { home: row.homeCurrency } : {}),
			},
		};
	}
	return {
		exchangeRate: Number(row.exchangeRate.toString()),
		pricingSource: row.pricingSource,
		...(row.rateType ? { rateType: row.rateType } : {}),
	};
}

/** The fields the form saves, as `row` holds them now. */
function fieldsOf(row: ExpenseRow) {
	return {
		title: row.title,
		// Decimal text: every stored digit comes back.
		amount: row.amount.toFixed(),
		currency: row.currency,
		date: row.date,
		location: row.location ?? undefined,
		description: row.description ?? undefined,
		categoryId: row.categoryId ?? undefined,
		amortizeOver: row.isAmortizedParent ? row.children.length : undefined,
		excludeFromAnalytics: row.excludeFromAnalytics,
		...rateInputOf(row),
	};
}

async function ownExpense(tx: Tx, userId: string, id: string) {
	const row = await tx.expense.findFirst({
		where: { id, userId, direction: "OUT", isAmortizedChild: false },
		include: {
			children: { select: { id: true } },
			_count: { select: { accountLegs: true } },
		},
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	}
	return row;
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
	if (user?.homeCurrency === home) return;
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: `This rate was into ${home}, your old home currency. Edit the rate instead.`,
	});
}

export interface UpdatedExpense {
	readonly id: string;
	/** expense.update with this input puts the expense back. */
	readonly restore: UpdateExpenseInput;
}

export const updateExpenseEntry: MoneyMutation<
	UpdateExpenseInput,
	UpdatedExpense
> = {
	id: "expense.update",
	touches: EXPENSE_FIGURES,
	run: async (tx, input, actor) => {
		const before = await ownExpense(tx, actor.userId, input.id);
		await refuseOtherHome(tx, actor.userId, input.customRate?.home);
		await new ExpenseService(tx).updateExpense(actor.userId, input);
		return {
			value: { id: input.id, restore: { id: input.id, ...fieldsOf(before) } },
			undo: {
				kind: "revert",
				mutation: "expense.update",
				rows: [{ table: "expense", id: input.id }],
			},
		};
	},
};

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
			const before = await ownExpense(tx, actor.userId, input.id);
			if (before._count.accountLegs > 0) {
				// A transfer's fee: it goes with its transfer.
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"This expense moved money in an account. Undo it from its transfer.",
				});
			}
			const snapshot = await snapshotExpense(tx, actor.userId, input.id);
			await new ExpenseService(tx).deleteExpense(actor.userId, input.id);
			return {
				value: { id: input.id, restore: signRestore(snapshot) },
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
		const snapshot = readRestore<ExpenseSnapshot>(input.token);
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
