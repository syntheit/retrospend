/**
 * income.confirmRecurring (INCOME.md §4, 2D.2): recurring income arrived.
 * One action posts the Money in row for the due date (the real amount for a
 * template whose amount varies), lands it in the account picked, advances
 * the template, and, with `usePlan`, assigns it by the envelope budget's
 * plan (plan-seam.ts). The row comes from money-in.service's recurringEntryData, the same
 * one the recurring confirm and the sidecar post. Undo
 * (income.unconfirmRecurring) removes the row, takes the plan's batch back
 * and rewinds the template.
 */

import { TRPCError } from "@trpc/server";
import type { RestChoice } from "~/lib/schemas/envelope";
import { dayKey } from "~/lib/time-zone";
import type { Money } from "~/server/figures/registry";
import { forgetMonthViews } from "~/server/services/envelope/month-read";
import { dec, toMinor } from "~/server/services/envelope/units";
import {
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "~/server/services/envelope/verdict";
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
import { countedOnArrival, inBudget } from "../accounts/places";
import { dayOf, endOfDay } from "../accounts/series";
import { homePerUnit } from "../accounts/valuation";
import { INCOME_FIGURES } from "./add.mutation";
import { incomeRow } from "./delete.mutation";
import { nextDueDay } from "./due-day";
import {
	applyPlanFor,
	PLAN_NOT_REQUESTED,
	type PlanResult,
	undoPlan,
} from "./plan-seam";

type Tx = Prisma.TransactionClient;

export interface ConfirmRecurringIncomeInput {
	readonly templateId: string;
	/** The due date being confirmed; a repeat of the same confirm is refused. */
	readonly dueDate?: Date | null;
	/** The real amount as typed (a decimal string), required when the template's amount varies. */
	readonly amount?: string | null;
	/** Rate type for a foreign amount; null = the default (as income.add). */
	readonly rateType?: string | null;
	/** A typed rate: 1 unit of the template's currency = this much home. */
	readonly customRate?: string | null;
	readonly into?: string | null;
	readonly keep?: boolean | null;
	/** Use my plan (N72): assign the money by the plan in the same action. */
	readonly usePlan?: boolean;
	/** Where Use my plan puts the rest; Leave it when omitted. */
	readonly planRest?: RestChoice | null;
	readonly timeZone?: string;
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
	// Due once its day has come in the user's zone, the day every leg is dated by.
	if (
		(input.dueDate &&
			input.dueDate.getTime() !== template.nextDueDate.getTime()) ||
		dayOf(template.nextDueDate) > dayKey(new Date(), input.timeZone)
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
		input.customRate
			? {
					kind: "custom",
					base: template.currency,
					value: input.customRate,
				}
			: { kind: "table", rateType: input.rateType ?? null },
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
			nextDueDate: nextDueDay(
				template.nextDueDate,
				template.frequency,
				template.anchorDay,
			),
			anchorDay: template.anchorDay ?? template.nextDueDate.getUTCDate(),
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
	// The budget read before this write (a preview's before side) is stale now.
	forgetMonthViews(tx);
	const amount = dec(row.amount.toString());
	const day = row.date.toISOString().slice(0, 10);
	const pick = await ratePickFor(tx, [
		home,
		row.currency,
		...(account ? [account.currency] : []),
	]);
	// The home leg the row booked (bookRate, as income.add): the plan and the leg use it.
	const booked =
		row.homeAmount && row.homeCurrency === home
			? dec(row.homeAmount.toString())
			: null;
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
		const units =
			perUnit && booked ? booked.div(perUnit).toDecimalPlaces(8) : amount;
		into = await writeLeg(tx, userId, {
			account,
			currency: account.currency,
			amount: units,
			date: row.date,
			source: "INCOME",
			expenseId: row.id,
			home: booked && { amount: booked, currency: home },
			countedUnits: countedOnArrival(account, kept, home) ? units : undefined,
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
				rest: input.planRest ?? undefined,
			})
		: PLAN_NOT_REQUESTED;
	// Recorded on the row, so the undo takes the batch back by itself.
	if (plan.batchId) {
		await tx.expense.update({
			where: { id: row.id },
			data: { planBatchId: plan.batchId },
		});
	}
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
	touches: [
		...INCOME_FIGURES,
		"spent",
		FIGURE_NOT_PLANNED_YET,
		FIGURE_LEFT_TO_SPEND,
	],
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
	if (row.planBatchId) await undoPlan(tx, userId, row.planBatchId);
	const accounts = await reverseLegs(tx, { expenseId: row.id });
	await tx.expense.delete({ where: { id: row.id } });
	forgetMonthViews(tx);
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
	touches: [
		...INCOME_FIGURES,
		"spent",
		FIGURE_NOT_PLANNED_YET,
		FIGURE_LEFT_TO_SPEND,
	],
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
