import { randomUUID } from "node:crypto";
import type {
	ActivityFilterValue,
	bulkCategorySchema,
	CursorQuery,
	createExpenseSchema,
	ExpenseDto,
	updateExpenseSchema,
} from "@retrospend/api-contract";
import { withDefaultRange } from "@retrospend/api-contract";
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import {
	type CategorizeInput,
	categorizeExpenses as categorizeMutation,
} from "~/server/services/entry/categorize.mutation";
import {
	deleteExpenseEntry,
	restoreExpenseEntry,
	type UpdateExpenseInput,
	updateExpenseEntry,
} from "~/server/services/entry/expense.mutation";
import { unlessChanged } from "~/server/services/entry/guarded.mutation";
import type { RestoreToken } from "~/server/services/entry/restore-token";
import {
	type CreateExpenseInput,
	ExpenseService,
} from "~/server/services/expense.service";
import { createExpense } from "~/server/services/expense-create.mutation";
import { listHomeCurrency } from "~/server/services/expense-dto";
import { listActivity } from "~/server/services/expense-list";
import type { MoneyMutation } from "~/server/services/preview/types";
import { bookedHome } from "~/server/services/rate-types";
import { titleSuggestions } from "~/server/services/title-suggestions.service";
import type { Prisma } from "~prisma";
import { type Caller, moneyOf } from "./caller";
import { applyWrite, previewWrite, spendUndo, undoFor } from "./money-write";
import { readUndo } from "./undo";

/** v1 adapters for /expenses. The mutations are the web's own (entry/expense.mutation.ts). */

export type LedgerCaller = Caller & { timeZone: string };

type Fields = z.infer<typeof createExpenseSchema>;
type ExpenseRow = Prisma.ExpenseGetPayload<{
	include: { children: { select: { id: true } } };
}>;

function kindOf(row: ExpenseRow): ExpenseDto["kind"] {
	if (row.entryKind === "NOT_SPENDING") return "transfer";
	if (row.direction === "IN")
		return row.inType === "REFUND" ? "refund" : "income";
	return "expense";
}

export function toExpenseDto(
	row: ExpenseRow,
	home: string,
	timeZone: string,
): ExpenseDto {
	return {
		id: row.id,
		kind: kindOf(row),
		title: row.title,
		amount: moneyOf(row.amount, row.currency),
		home: row.currency === home ? null : bookedHome(row, home),
		rateType: row.rateType,
		date: dayKey(row.date, timeZone),
		categoryId: row.categoryId,
		location: row.location,
		description: row.description,
		amortizeOver: row.isAmortizedParent ? row.children.length : null,
		excludeFromAnalytics: row.excludeFromAnalytics,
		recurringTemplateId: row.recurringTemplateId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export async function readExpense(
	caller: LedgerCaller,
	id: string,
): Promise<ExpenseDto> {
	const { db, principal } = caller;
	const row = await new ExpenseService(db).getExpense(principal.userId, id);
	if (!row)
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	return toExpenseDto(
		row,
		await listHomeCurrency(db, principal.userId),
		caller.timeZone,
	);
}

export function listExpenses(
	caller: LedgerCaller,
	filter: ActivityFilterValue,
	page: CursorQuery,
) {
	const f = withDefaultRange(filter, dayKey(new Date(), caller.timeZone));
	return listActivity(
		caller.db,
		caller.principal.userId,
		{
			from: f.from,
			to: f.to,
			categoryIds: f.categoryIds,
			projectIds: f.projectIds,
			people: f.people,
			paidBy: f.paidBy,
			kinds: f.kinds,
			q: f.q,
			cursor: page.cursor,
			limit: page.limit,
		},
		caller.timeZone,
	);
}

/** The service's input for a form: a typed rate wins over a rate type. */
function toServiceInput(
	id: string,
	f: Omit<Fields, "id">,
	timeZone: string,
): CreateExpenseInput {
	const { date, customRate, rateType, ...rest } = f;
	return {
		...rest,
		id,
		date: parseDateOnlyIn(date, timeZone),
		...(customRate
			? { customRate: { base: f.currency, value: customRate } }
			: rateType
				? { rateType }
				: {}),
	};
}

export function createInput(caller: LedgerCaller, input: Fields) {
	const { id, ...fields } = input;
	return toServiceInput(id ?? randomUUID(), fields, caller.timeZone);
}

export function updateInput(
	caller: LedgerCaller,
	input: z.infer<typeof updateExpenseSchema>,
): UpdateExpenseInput {
	const { id, ...fields } = input;
	return toServiceInput(id, fields, caller.timeZone);
}

export async function addExpense(caller: LedgerCaller, input: Fields) {
	const args = createInput(caller, input);
	const created = await applyWrite(caller, createExpense, args);
	const expense = await readExpense(caller, created.id);
	return {
		expense,
		undo: undoFor(caller, "expense", "expense.delete", {
			id: created.id,
			expectedUpdatedAt: expense.updatedAt,
		}),
	};
}

export const previewAddExpense = (caller: LedgerCaller, input: Fields) =>
	previewWrite(caller, createExpense, createInput(caller, input));

export async function replaceExpense(
	caller: LedgerCaller,
	input: z.infer<typeof updateExpenseSchema>,
) {
	const done = await applyWrite(
		caller,
		updateExpenseEntry,
		updateInput(caller, input),
	);
	const expense = await readExpense(caller, done.id);
	return {
		expense,
		undo: undoFor(caller, "expense", "expense.update", {
			restore: done.restore,
			expectedUpdatedAt: expense.updatedAt,
		}),
	};
}

export const previewReplaceExpense = (
	caller: LedgerCaller,
	input: z.infer<typeof updateExpenseSchema>,
) => previewWrite(caller, updateExpenseEntry, updateInput(caller, input));

export async function removeExpense(caller: LedgerCaller, id: string) {
	const done = await applyWrite(caller, deleteExpenseEntry, { id });
	return {
		id: done.id,
		undo: undoFor(caller, "expense", "expense.restore", {
			token: done.restore,
		}),
	};
}

export const previewRemoveExpense = (caller: LedgerCaller, id: string) =>
	previewWrite(caller, deleteExpenseEntry, { id });

type Bulk = z.infer<typeof bulkCategorySchema>;

const bulkInput = (input: Bulk): CategorizeInput => ({
	moves: [{ categoryId: input.categoryId, ids: input.ids }],
});

export async function categorizeExpenses(caller: Caller, input: Bulk) {
	const done = await applyWrite(caller, categorizeMutation, bulkInput(input));
	return {
		updated: done.updated,
		undo: undoFor(caller, "expense", "expense.categorize", {
			moves: done.previous,
			lenient: true,
		}),
	};
}

export const previewCategorizeExpenses = (caller: Caller, input: Bulk) =>
	previewWrite(caller, categorizeMutation, bulkInput(input));

export async function checkDuplicate(
	caller: LedgerCaller,
	q: { title: string; amount: string; date: string },
) {
	const match = await new ExpenseService(caller.db).findDuplicate(
		caller.principal.userId,
		{
			title: q.title,
			amount: q.amount,
			date: parseDateOnlyIn(q.date, caller.timeZone),
			timeZone: caller.timeZone,
		},
	);
	return { duplicate: match !== null, expenseId: match?.id ?? null };
}

export async function suggestTitles(caller: Caller, q: string) {
	const rows = await titleSuggestions(caller.db, caller.principal.userId, q);
	return {
		items: rows.map((r) => ({
			title: r.title,
			count: r.count,
			lastCategoryId: r.lastCategoryId,
			lastAmount:
				r.lastAmount !== null && r.lastCurrency !== null
					? moneyOf(String(r.lastAmount), r.lastCurrency)
					: null,
		})),
	};
}

// ── Undo ────────────────────────────────────────────────────────────────────

/** An inverse call: the mutation, its input and the redo token its value gives. */
type Step<I, V> = {
	mutation: MoneyMutation<I, V>;
	input: I;
	redo: (value: V) => { op: string; input: unknown };
	idOf: (value: V) => string | null;
};

const step = <I, V>(s: Step<I, V>) => s as unknown as Step<unknown, unknown>;

type Stamped = { expectedUpdatedAt?: string };

function stepOf(op: string, input: unknown): Step<unknown, unknown> {
	switch (op) {
		case "expense.delete": {
			const { id, expectedUpdatedAt } = input as { id: string } & Stamped;
			return step({
				mutation: unlessChanged(deleteExpenseEntry, expectedUpdatedAt),
				input: { id },
				redo: (v) => ({ op: "expense.restore", input: { token: v.restore } }),
				idOf: (v) => v.id,
			});
		}
		case "expense.update": {
			const { restore, expectedUpdatedAt } = input as {
				restore: UpdateExpenseInput;
			} & Stamped;
			// JSON turned the date into text.
			return step({
				mutation: unlessChanged(updateExpenseEntry, expectedUpdatedAt),
				input: { ...restore, date: new Date(restore.date) },
				redo: (v) => ({
					op: "expense.update",
					input: { restore: v.restore },
				}),
				idOf: (v) => v.id,
			});
		}
		case "expense.restore":
			return step({
				mutation: restoreExpenseEntry,
				input: input as { token: RestoreToken },
				redo: (v) => ({ op: "expense.delete", input: { id: v.id } }),
				idOf: (v) => v.id,
			});
		case "expense.categorize":
			return step({
				mutation: categorizeMutation,
				input: input as CategorizeInput,
				redo: (v) => ({
					op: "expense.categorize",
					input: { moves: v.previous, lenient: true },
				}),
				idOf: () => null,
			});
		default:
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "This undo is not valid anymore",
			});
	}
}

/** The redo guards against edits made after the undo, like the original token does. */
async function stampedRedo(
	caller: Caller,
	redo: { op: string; input: unknown },
	id: string | null,
) {
	if (!id || (redo.op !== "expense.update" && redo.op !== "expense.delete"))
		return redo;
	const row = await caller.db.expense.findFirst({
		where: { id, userId: caller.principal.userId },
		select: { updatedAt: true },
	});
	return {
		op: redo.op,
		input: {
			...(redo.input as object),
			expectedUpdatedAt: row?.updatedAt.toISOString(),
		},
	};
}

export async function undoExpenseWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, "expense", token);
	const inverse = stepOf(op, input);
	return spendUndo(caller, token, async () => {
		const value = await applyWrite(caller, inverse.mutation, inverse.input);
		const id = inverse.idOf(value);
		const redo = await stampedRedo(caller, inverse.redo(value), id);
		return { id, redo: undoFor(caller, "expense", redo.op, redo.input) };
	});
}

export function previewUndoExpenseWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, "expense", token);
	const inverse = stepOf(op, input);
	return previewWrite(caller, inverse.mutation, inverse.input);
}
