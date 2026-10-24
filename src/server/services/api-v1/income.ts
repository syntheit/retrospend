import type { addIncomeSchema } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import {
	type AddIncomeInput,
	addIncome,
	type IncomeValue,
} from "~/server/services/income/add.mutation";
import { deleteIncome } from "~/server/services/income/delete.mutation";
import type { PlanResult } from "~/server/services/income/plan-seam";
import type { Caller } from "./caller";
import {
	accountChangeDto,
	applyWrite,
	previewWrite,
	undoFor,
} from "./money-write";
import { readUndo } from "./undo";

/** v1 adapters for /income. The mutations are the web's own (income/*.mutation.ts). */

type LedgerCaller = Caller & { timeZone: string };
type Input = z.infer<typeof addIncomeSchema>;

const FAMILY = "income" as const;

function addInput(caller: LedgerCaller, input: Input): AddIncomeInput {
	return { ...input, timeZone: caller.timeZone };
}

export function planDto(plan: PlanResult) {
	return {
		applied: plan.applied,
		reason: plan.reason,
		batchId: plan.batchId,
		lines: plan.lines.map((l) => ({ ...l })),
		rest: plan.rest,
		restChoice: plan.restChoice,
	};
}

export function incomeResult(v: IncomeValue) {
	return {
		id: v.expenseId,
		booked: v.booked,
		account: v.into ? accountChangeDto(v.into) : null,
		kept: v.kept,
		templateId: v.templateId,
		plan: planDto(v.plan),
	};
}

export async function createIncome(caller: LedgerCaller, input: Input) {
	const value = await applyWrite(caller, addIncome, addInput(caller, input));
	return {
		income: incomeResult(value),
		undo: undoFor(caller, FAMILY, "income.delete", {
			expenseId: value.expenseId,
			templateId: value.templateId,
		}),
	};
}

export const previewCreateIncome = (caller: LedgerCaller, input: Input) =>
	previewWrite(caller, addIncome, addInput(caller, input));

function deleteInput(caller: LedgerCaller, id: string, templateId?: string) {
	return { expenseId: id, templateId, timeZone: caller.timeZone };
}

export async function removeIncome(
	caller: LedgerCaller,
	id: string,
	templateId?: string,
) {
	const value = await applyWrite(
		caller,
		deleteIncome,
		deleteInput(caller, id, templateId),
	);
	return {
		id: value.expenseId,
		accounts: value.accounts.map(accountChangeDto),
		undo: undoFor(caller, FAMILY, "income.add", value.recreate),
	};
}

export const previewRemoveIncome = (
	caller: LedgerCaller,
	id: string,
	templateId?: string,
) => previewWrite(caller, deleteIncome, deleteInput(caller, id, templateId));

// ── Undo ────────────────────────────────────────────────────────────────────

type Delete = { expenseId: string; templateId?: string | null };

/** The inverse call a token names, ready to preview or to apply. */
function inverseOf(caller: LedgerCaller, op: string, input: unknown) {
	const zone = { timeZone: caller.timeZone };
	if (op === "income.delete") {
		const args = { ...(input as Delete), ...zone };
		return {
			preview: () => previewWrite(caller, deleteIncome, args),
			apply: async () => {
				const value = await applyWrite(caller, deleteIncome, args);
				return {
					id: value.expenseId,
					accounts: value.accounts.map(accountChangeDto),
					redo: undoFor(caller, FAMILY, "income.add", value.recreate),
				};
			},
		};
	}
	if (op === "income.add") {
		const args = { ...(input as AddIncomeInput), ...zone };
		return {
			preview: () => previewWrite(caller, addIncome, args),
			apply: async () => {
				const value = await applyWrite(caller, addIncome, args);
				return {
					id: value.expenseId,
					accounts: value.into ? [accountChangeDto(value.into)] : [],
					redo: undoFor(caller, FAMILY, "income.delete", {
						expenseId: value.expenseId,
						templateId: value.templateId,
					}),
				};
			},
		};
	}
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});
}

export function undoIncomeWrite(caller: LedgerCaller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return inverseOf(caller, op, input).apply();
}

export function previewUndoIncomeWrite(caller: LedgerCaller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return inverseOf(caller, op, input).preview();
}
