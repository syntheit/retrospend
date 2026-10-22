/**
 * income.confirmRecurring (INCOME.md §4, 2D.2): recurring income arrived.
 * One action posts the Money in row for the due date (the real amount for a
 * template whose amount varies), lands it in the account picked, advances
 * the template, and, with `usePlan`, assigns it by the plan (seam until 2B
 * P2). The row comes from money-in.service's recurringEntryData, the same
 * one the recurring confirm and the sidecar post. Undo
 * (income.unconfirmRecurring) removes the row and rewinds the template.
 */
import { TRPCError } from "@trpc/server";
import { nextRecurringDate } from "~/lib/recurring";
import type { Money } from "~/server/figures/registry";
import { dec, toMinor } from "~/server/services/envelope/units";
import { recurringEntryData } from "~/server/services/money-in.service";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma } from "~prisma";
import {
	type AccountChange,
	homeCurrencyOf,
	lockOpenAccount,
	ratePickFor,
	reverseLegs,
	writeLeg,
} from "../accounts/ledger";
import { inBudget } from "../accounts/places";
import { endOfDay } from "../accounts/series";
import { homePerUnit, homeValue } from "../accounts/valuation";
import { INCOME_FIGURES } from "./add.mutation";
import { incomeRow } from "./delete.mutation";
import { applyPlanFor, type PlanResult } from "./plan-seam";

type Tx = Prisma.TransactionClient;

export interface ConfirmRecurringIncomeInput {
	readonly templateId: string;
	/** The due date being confirmed; a repeat of the same confirm is refused. */
	readonly dueDate?: Date | null;
	/** The real amount, required when the template's amount varies. */
	readonly amount?: number | null;
	readonly into?: string | null;
	readonly keep?: boolean | null;
	/** Use my plan (N72): assign the money by the plan in the same action. */
	readonly usePlan?: boolean;
}

export interface ConfirmedIncome {
	readonly expenseId: string;
	readonly templateId: string;
	readonly booked: Money | null;
	readonly into: AccountChange | null;
	readonly kept: boolean;
	readonly plan: PlanResult;
}

async function dueTemplate(
	tx: Tx,
	userId: string,
	input: ConfirmRecurringIncomeInput,
) {
	const template = await tx.recurringTemplate.findFirst({
		where: { id: input.templateId, userId, isActive: true, direction: "IN" },
	});
	if (!template) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Recurring income not found",
		});
	}
	if (
		(input.dueDate &&
			input.dueDate.getTime() !== template.nextDueDate.getTime()) ||
		template.nextDueDate > new Date()
	) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "This income was already confirmed",
		});
	}
	return template;
}

export async function confirmRecurringIncomeIn(
	tx: Tx,
	userId: string,
	input: ConfirmRecurringIncomeInput,
): Promise<ConfirmedIncome> {
	const template = await dueTemplate(tx, userId, input);
	const entry = await recurringEntryData(
		tx,
		template,
		input.amount ?? undefined,
	);
	const home = await homeCurrencyOf(tx, userId);
	const account = input.into
		? await lockOpenAccount(tx, userId, input.into)
		: null;
	const kept = input.keep ?? (account ? !inBudget(account, home) : false);
	if (kept && !account) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Pick the account it stays in",
		});
	}
	// Advance only while nextDueDate is the one read, so racing confirms post once.
	const advanced = await tx.recurringTemplate.updateMany({
		where: { id: template.id, userId, nextDueDate: template.nextDueDate },
		data: {
			nextDueDate: nextRecurringDate(
				template.nextDueDate,
				template.frequency,
				template.anchorDay,
			),
			anchorDay: template.anchorDay ?? template.nextDueDate.getDate(),
		},
	});
	if (advanced.count === 0) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "This income was already confirmed",
		});
	}
	const row = await tx.expense.create({
		data: { ...entry, keepInWealth: kept },
	});
	const amount = dec(row.amount.toString());
	const day = row.date.toISOString().slice(0, 10);
	const pick = await ratePickFor(tx, [
		home,
		row.currency,
		...(account ? [account.currency] : []),
	]);
	const valued = {
		currency: row.currency,
		rateType: null,
		storedRate: row.exchangeRate,
	};
	const booked =
		homeValue(pick, valued, amount, home, endOfDay(day))?.toDecimalPlaces(8) ??
		null;
	let into: AccountChange | null = null;
	if (account) {
		const perUnit =
			account.currency === row.currency
				? null
				: homePerUnit(
						pick,
						{
							currency: account.currency,
							rateType: account.exchangeRateType,
							storedRate: account.exchangeRate,
						},
						home,
						endOfDay(day),
					);
		if (account.currency !== row.currency && (!perUnit || !booked)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `No exchange rate to put ${row.currency} into ${account.currency}`,
			});
		}
		into = await writeLeg(tx, userId, {
			account,
			currency: account.currency,
			amount:
				perUnit && booked ? booked.div(perUnit).toDecimalPlaces(8) : amount,
			date: row.date,
			source: "INCOME",
			expenseId: row.id,
			home: booked && { amount: booked, currency: home },
		});
	}
	const bookedMoney = booked && {
		minor: toMinor(booked, home),
		currency: home,
	};
	const plan: PlanResult = input.usePlan
		? await applyPlanFor(tx, {
				userId,
				incomeExpenseId: row.id,
				amount: kept ? null : bookedMoney,
			})
		: { applied: false, reason: "not_requested" };
	return {
		expenseId: row.id,
		templateId: template.id,
		booked: bookedMoney,
		into,
		kept,
		plan,
	};
}

export const confirmRecurringIncome: MoneyMutation<
	ConfirmRecurringIncomeInput,
	ConfirmedIncome
> = {
	id: "income.confirmRecurring",
	touches: [...INCOME_FIGURES, "spent"],
	scope: (input) => (input.into ? { accountId: input.into } : {}),
	run: async (tx, input, actor) => {
		const value = await confirmRecurringIncomeIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "income.unconfirmRecurring",
				rows: [
					{ table: "expense", id: value.expenseId },
					{ table: "recurring_template", id: value.templateId },
				],
			},
		};
	},
};

export interface UnconfirmRecurringIncomeInput {
	readonly expenseId: string;
}

/** Removes the posted row (its leg goes back) and puts the template back on that due date. */
export async function unconfirmRecurringIncomeIn(
	tx: Tx,
	userId: string,
	input: UnconfirmRecurringIncomeInput,
) {
	const row = await incomeRow(tx, userId, input.expenseId);
	if (!row.recurringTemplateId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This income is not from a recurring template",
		});
	}
	if (row.movedInAt) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Undo the Move in first",
		});
	}
	const accounts = await reverseLegs(tx, { expenseId: row.id });
	await tx.expense.delete({ where: { id: row.id } });
	await tx.recurringTemplate.updateMany({
		where: {
			id: row.recurringTemplateId,
			userId,
			nextDueDate: { gt: row.date },
		},
		data: { nextDueDate: row.date },
	});
	return { expenseId: row.id, templateId: row.recurringTemplateId, accounts };
}

export const unconfirmRecurringIncome: MoneyMutation<
	UnconfirmRecurringIncomeInput,
	Awaited<ReturnType<typeof unconfirmRecurringIncomeIn>>
> = {
	id: "income.unconfirmRecurring",
	touches: [...INCOME_FIGURES, "spent"],
	run: async (tx, input, actor) => {
		const value = await unconfirmRecurringIncomeIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "income.confirmRecurring",
				rows: [{ table: "recurring_template", id: value.templateId }],
			},
		};
	},
};
