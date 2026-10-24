import type {
	CursorQuery,
	confirmRecurringSchema,
	createRecurringSchema,
	RecurringItemDto,
	updateRecurringSchema,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
	type ConfirmRecurringIncomeInput,
	confirmRecurringIncome,
	unconfirmRecurringIncome,
} from "~/server/services/income/confirm-recurring.mutation";
import {
	createTemplate,
	deleteTemplate,
	templateDirection,
	templateDueAt,
	templateExtras,
	updateTemplate,
} from "~/server/services/recurring.service";
import {
	confirmRecurringExpense,
	unconfirmRecurringExpense,
} from "~/server/services/recurring-confirm.mutation";
import {
	listRecurringView,
	type RecurringItemDTO,
} from "~/server/services/recurring-view.service";
import type { Caller } from "./caller";
import { decodeCursor, toPage } from "./cursor";
import { planDto } from "./income";
import {
	accountChangeDto,
	applyWrite,
	previewWrite,
	spendUndo,
	undoFor,
} from "./money-write";
import { readUndo } from "./undo";

/** v1 adapters for /recurring. */

type LedgerCaller = Caller & { timeZone: string };

const FAMILY = "recurring" as const;

const dueCursor = z.object({ dueAt: z.string(), id: z.string() });

async function loadItems(caller: LedgerCaller) {
	const view = await listRecurringView(
		caller.db,
		caller.principal.userId,
		caller.timeZone,
	);
	const extras = await templateExtras(caller.db, caller.principal.userId);
	const items = view.items.map(
		(item: RecurringItemDTO): RecurringItemDto => ({
			...item,
			websiteUrl: extras.get(item.id)?.websiteUrl ?? null,
			paymentSource: extras.get(item.id)?.paymentSource ?? null,
			updatedAt: (extras.get(item.id)?.updatedAt ?? new Date(0)).toISOString(),
		}),
	);
	return { view, items };
}

/**
 * Templates are few, so the page is cut from the view's own order
 * (next due, then id) rather than re-queried.
 */
export async function listRecurring(caller: LedgerCaller, q: CursorQuery) {
	const { items } = await loadItems(caller);
	const after = decodeCursor(q.cursor, dueCursor);
	const rest = after
		? items.filter(
				(i) =>
					i.dueAt > after.dueAt || (i.dueAt === after.dueAt && i.id > after.id),
			)
		: items;
	return toPage(
		rest.slice(0, q.limit + 1),
		q.limit,
		(i) => ({ dueAt: i.dueAt, id: i.id }),
		(i) => i,
	);
}

export async function recurringSummary(caller: LedgerCaller) {
	const { view } = await loadItems(caller);
	return {
		today: view.today,
		homeCurrency: view.homeCurrency,
		out: view.out,
		in: view.in,
		logged: view.logged,
	};
}

export async function readRecurring(caller: LedgerCaller, id: string) {
	const { items } = await loadItems(caller);
	const item = items.find((i) => i.id === id);
	if (!item)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Recurring template not found",
		});
	return item;
}

export async function addRecurring(
	caller: LedgerCaller,
	input: z.infer<typeof createRecurringSchema>,
) {
	const created = await createTemplate(
		caller.db,
		caller.principal.userId,
		{
			...input,
			direction: input.direction === "in" ? "IN" : "OUT",
			amountMode: input.amountMode === "ask" ? "ASK" : "FIXED",
		},
		caller.timeZone,
	);
	return readRecurring(caller, created.id);
}

export async function changeRecurring(
	caller: LedgerCaller,
	input: z.infer<typeof updateRecurringSchema>,
) {
	const { id, paused, amountMode, ...rest } = input;
	await updateTemplate(
		caller.db,
		caller.principal.userId,
		id,
		{
			...rest,
			amountMode: amountMode
				? amountMode === "ask"
					? "ASK"
					: "FIXED"
				: undefined,
			isActive: paused === undefined ? undefined : !paused,
		},
		caller.timeZone,
	);
	return readRecurring(caller, id);
}

export async function removeRecurring(caller: Caller, id: string) {
	await deleteTemplate(caller.db, caller.principal.userId, id);
	return { ok: true as const };
}

// ── Confirm ─────────────────────────────────────────────────────────────────

type ConfirmInput = z.infer<typeof confirmRecurringSchema>;

const INCOME_ONLY = [
	"rateType",
	"customRate",
	"into",
	"keep",
	"usePlan",
	"planRest",
] as const;

function incomeInput(
	caller: LedgerCaller,
	input: ConfirmInput,
): ConfirmRecurringIncomeInput {
	return {
		templateId: input.id,
		dueDate: input.dueAt ? new Date(input.dueAt) : null,
		amount: input.amount,
		rateType: input.rateType,
		customRate: input.customRate,
		into: input.into,
		keep: input.keep,
		usePlan: input.usePlan,
		planRest: input.planRest,
		timeZone: caller.timeZone,
	};
}

function expenseInput(caller: LedgerCaller, input: ConfirmInput) {
	const stray = INCOME_ONLY.filter(
		(k) => input[k] !== undefined && input[k] !== null,
	);
	if (stray.length > 0)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `${stray.join(", ")} only apply to recurring income`,
		});
	return {
		templateId: input.id,
		dueDate: input.dueAt ? new Date(input.dueAt) : null,
		amount: input.amount,
		timeZone: caller.timeZone,
	};
}

export async function confirmRecurring(
	caller: LedgerCaller,
	input: ConfirmInput,
) {
	const { db, principal } = caller;
	const direction = await templateDirection(db, principal.userId, input.id);
	if (direction === "IN") {
		const v = await applyWrite(
			caller,
			confirmRecurringIncome,
			incomeInput(caller, input),
		);
		const due = await templateDueAt(db, principal.userId, input.id);
		return {
			confirmed: {
				expenseId: v.expenseId,
				templateId: v.templateId,
				direction: "in" as const,
				nextDueAt: due?.toISOString() ?? null,
				booked: v.booked,
				account: v.into ? accountChangeDto(v.into) : null,
				kept: v.kept,
				plan: planDto(v.plan),
			},
			undo: undoFor(caller, FAMILY, "income.unconfirmRecurring", {
				expenseId: v.expenseId,
			}),
		};
	}
	const v = await applyWrite(
		caller,
		confirmRecurringExpense,
		expenseInput(caller, input),
	);
	return {
		confirmed: {
			expenseId: v.expenseId,
			templateId: v.templateId,
			direction: "out" as const,
			nextDueAt: v.nextDueAt.toISOString(),
			booked: null,
			account: null,
			kept: null,
			plan: null,
		},
		undo: undoFor(caller, FAMILY, "recurring.unconfirm", {
			expenseId: v.expenseId,
		}),
	};
}

export async function previewConfirmRecurring(
	caller: LedgerCaller,
	input: ConfirmInput,
) {
	const { db, principal } = caller;
	const direction = await templateDirection(db, principal.userId, input.id);
	return direction === "IN"
		? previewWrite(caller, confirmRecurringIncome, incomeInput(caller, input))
		: previewWrite(
				caller,
				confirmRecurringExpense,
				expenseInput(caller, input),
			);
}

// ── Undo ────────────────────────────────────────────────────────────────────

function expenseIdOf(op: string, input: unknown): string {
	if (op !== "recurring.unconfirm" && op !== "income.unconfirmRecurring")
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This undo is not valid anymore",
		});
	return (input as { expenseId: string }).expenseId;
}

export async function undoRecurringConfirm(
	caller: LedgerCaller,
	token: string,
) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	const expenseId = expenseIdOf(op, input);
	const done = await spendUndo(caller, token, () =>
		op === "recurring.unconfirm"
			? applyWrite(caller, unconfirmRecurringExpense, { expenseId })
			: applyWrite(caller, unconfirmRecurringIncome, { expenseId }),
	);
	return { expenseId: done.expenseId, templateId: done.templateId, redo: null };
}

export function previewUndoRecurringConfirm(
	caller: LedgerCaller,
	token: string,
) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	const expenseId = expenseIdOf(op, input);
	return op === "recurring.unconfirm"
		? previewWrite(caller, unconfirmRecurringExpense, { expenseId })
		: previewWrite(caller, unconfirmRecurringIncome, { expenseId });
}
