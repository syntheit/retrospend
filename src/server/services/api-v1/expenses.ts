import { randomUUID } from "node:crypto";
import type {
	ActivityFilterValue,
	CursorQuery,
	createExpenseSchema,
	ExpenseDto,
	updateExpenseSchema,
} from "@retrospend/api-contract";
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import {
	deleteExpenseEntry,
	restoreExpenseEntry,
	type UpdateExpenseInput,
	updateExpenseEntry,
} from "~/server/services/entry/expense.mutation";
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
import { applyWrite, previewWrite, undoFor } from "./money-write";
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
	return listActivity(
		caller.db,
		caller.principal.userId,
		{
			from: filter.from,
			to: filter.to,
			categoryIds: filter.categoryIds,
			projectIds: filter.projectIds,
			people: filter.people,
			paidBy: filter.paidBy,
			kinds: filter.kinds,
			q: filter.q,
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
	return {
		expense: await readExpense(caller, created.id),
		undo: undoFor(caller, "expense", "expense.delete", { id: created.id }),
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
	return {
		expense: await readExpense(caller, done.id),
		undo: undoFor(caller, "expense", "expense.update", done.restore),
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

export async function categorizeExpenses(
	caller: Caller,
	ids: string[],
	categoryId: string,
) {
	const result = await new ExpenseService(caller.db).bulkUpdateCategory(
		caller.principal.userId,
		ids,
		categoryId,
	);
	return { updated: result.count };
}

export async function checkDuplicate(
	caller: LedgerCaller,
	q: { title: string; amount: string; date: string },
) {
	const match = await new ExpenseService(caller.db).findDuplicate(
		caller.principal.userId,
		{
			title: q.title,
			amount: Number(q.amount),
			date: parseDateOnlyIn(q.date, caller.timeZone),
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
	idOf: (value: V) => string;
};

const step = <I, V>(s: Step<I, V>) => s as unknown as Step<unknown, unknown>;

function stepOf(op: string, input: unknown): Step<unknown, unknown> {
	switch (op) {
		case "expense.delete":
			return step({
				mutation: deleteExpenseEntry,
				input: input as { id: string },
				redo: (v) => ({ op: "expense.restore", input: { token: v.restore } }),
				idOf: (v) => v.id,
			});
		case "expense.update": {
			const restore = input as UpdateExpenseInput;
			// JSON turned the date into text.
			return step({
				mutation: updateExpenseEntry,
				input: { ...restore, date: new Date(restore.date) },
				redo: (v) => ({ op: "expense.update", input: v.restore }),
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
		default:
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "This undo is not valid anymore",
			});
	}
}

export async function undoExpenseWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, "expense", token);
	const inverse = stepOf(op, input);
	const value = await applyWrite(caller, inverse.mutation, inverse.input);
	const redo = inverse.redo(value);
	return {
		id: inverse.idOf(value),
		redo: undoFor(caller, "expense", redo.op, redo.input),
	};
}

export function previewUndoExpenseWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, "expense", token);
	const inverse = stepOf(op, input);
	return previewWrite(caller, inverse.mutation, inverse.input);
}
