/**
 * income.add (MONEY-MOVES §2.2, owner N71: its own Add income sheet): one
 * Money in row (Expense direction IN, kind Income), into an account or not,
 * decided once: To assign, or kept in Wealth. The sheet previews this same
 * mutation (R30).
 *
 * - `into`: the account it lands in (a leg, N75). No account: no account and
 *   no net worth change; the money is in the budget only.
 * - `keep`: stays in Wealth, out of To assign. Default: kept when the account
 *   is outside the budget (§2.1). Keeping needs an account to stay in.
 * - `repeats`: also creates the recurring income template and links it.
 */
import { randomUUID } from "node:crypto";
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { TRPCError } from "@trpc/server";
import { computeAmountInUSD } from "~/lib/money";
import { requireExchangeRate } from "~/server/exchange-rates";
import type { Money } from "~/server/figures/registry";
import { dec, toMinor } from "~/server/services/envelope/units";
import { ensureIncomeCategories } from "~/server/services/money-in.service";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma, RecurringFrequency } from "~prisma";
import { moveDay } from "../accounts/dates";
import {
	type AccountChange,
	type AccountRow,
	homeCurrencyOf,
	lockOpenAccount,
	ratePickFor,
	writeLeg,
} from "../accounts/ledger";
import { countedOnArrival, inBudget } from "../accounts/places";
import { endOfDay } from "../accounts/series";
import { homePerUnit, homeValue } from "../accounts/valuation";
import { typedAmount } from "../transfers/plan";
import { nextDueDay } from "./due-day";

type Tx = Prisma.TransactionClient;

export const INCOME_FIGURES = [
	"netWorth",
	"accounts.balance",
	"netWorthChange.income",
	"netWorthChange.revaluation",
];

export interface AddIncomeInput {
	/** Set only by the undo of a delete, to bring the same row back. */
	readonly id?: string;
	readonly title: string;
	readonly amount: string;
	readonly currency: string;
	/** Rate type for a foreign amount (official, blue, mep...); null = the default. */
	readonly rateType?: string | null;
	readonly categoryId?: string | null;
	readonly description?: string | null;
	/** YYYY-MM-DD; today when omitted. */
	readonly date?: string | null;
	readonly into?: string | null;
	readonly keep?: boolean | null;
	readonly repeats?: {
		readonly frequency: RecurringFrequency;
		/** YYYY-MM-DD of the next one; one period after `date` when omitted. */
		readonly next?: string | null;
	} | null;
	/** Set only by the undo of a delete: the rates and units it was booked at. */
	readonly restore?: IncomeRestore | null;
	readonly timeZone?: string;
}

/** What income.delete read off the row and its leg, so its undo books nothing anew. */
export interface IncomeRestore {
	readonly exchangeRate: string;
	readonly amountInUSD: string;
	/** The units the leg put in the account; null without an account. */
	readonly units: string | null;
	readonly homeAmount: string | null;
	readonly homeCurrency: string | null;
	/** The leg's units still counted on the account when it was deleted. */
	readonly countedUnits?: string | null;
}

export interface IncomeValue {
	readonly expenseId: string;
	readonly amount: string;
	readonly currency: string;
	/** The income's value in the home currency at its own rate (I20); null when no rate exists. */
	readonly booked: Money | null;
	readonly into: AccountChange | null;
	/** Kept in Wealth (out of To assign) or in the budget. */
	readonly kept: boolean;
	readonly templateId: string | null;
}

async function incomeCategory(
	tx: Tx,
	userId: string,
	categoryId: string | null | undefined,
) {
	await ensureIncomeCategories(tx, userId);
	if (!categoryId) return null;
	const category = await tx.category.findFirst({
		where: { id: categoryId, userId, kind: "INCOME" },
		select: { id: true },
	});
	if (!category) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Pick an income category",
		});
	}
	return category.id;
}

/** The units that land in the account: the amount itself, or its booked value in the account's currency. */
function unitsInAccount(
	account: AccountRow,
	income: {
		amount: Decimal;
		currency: string;
		booked: Decimal | null;
		home: string;
	},
	pick: Parameters<typeof homePerUnit>[0],
	date: Date,
): Decimal {
	if (account.currency === income.currency) return income.amount;
	const perUnit = homePerUnit(
		pick,
		{
			currency: account.currency,
			rateType: account.exchangeRateType,
			storedRate: account.exchangeRate,
		},
		income.home,
		endOfDay(date.toISOString().slice(0, 10)),
	);
	if (!income.booked || !perUnit) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `No exchange rate to put ${income.currency} into a ${account.currency} account`,
		});
	}
	return income.booked.div(perUnit).toDecimalPlaces(8);
}

async function createTemplate(
	tx: Tx,
	userId: string,
	input: AddIncomeInput,
	row: { amount: Decimal; date: Date; categoryId: string | null },
) {
	if (!input.repeats) return null;
	const next = input.repeats.next
		? new Date(`${input.repeats.next}T00:00:00.000Z`)
		: nextDueDay(row.date, input.repeats.frequency);
	const template = await tx.recurringTemplate.create({
		data: {
			userId,
			name: input.title,
			amount: row.amount.toString(),
			currency: input.currency,
			categoryId: row.categoryId,
			direction: "IN",
			frequency: input.repeats.frequency,
			nextDueDate: next,
			anchorDay: next.getUTCDate(),
		},
		select: { id: true },
	});
	return template.id;
}

/** How the income is valued, and the units that land in the account. */
interface Priced {
	readonly exchangeRate: string;
	readonly amountInUSD: string;
	/** Booked home value (I20); null when no rate exists. */
	readonly booked: Decimal | null;
	readonly units: Decimal | null;
}

/** The income's rate, booked value and units at its own day's rates. */
async function priceIncome(
	tx: Tx,
	input: AddIncomeInput,
	ctx: {
		amount: Decimal;
		date: Date;
		home: string;
		account: AccountRow | null;
	},
): Promise<Priced> {
	const { amount, date, home, account } = ctx;
	const rate = await requireExchangeRate(
		tx,
		input.currency,
		date,
		input.rateType,
	);
	const pick = await ratePickFor(tx, [
		home,
		input.currency,
		...(account ? [account.currency] : []),
	]);
	const booked =
		homeValue(
			pick,
			{
				currency: input.currency,
				rateType: input.rateType ?? null,
				storedRate: rate.rate,
			},
			amount,
			home,
			endOfDay(date.toISOString().slice(0, 10)),
		)?.toDecimalPlaces(8) ?? null;
	return {
		exchangeRate: String(rate.rate),
		amountInUSD: String(
			computeAmountInUSD(amount.toNumber(), input.currency, rate.rate),
		),
		booked,
		units:
			account &&
			unitsInAccount(
				account,
				{ amount, currency: input.currency, booked, home },
				pick,
				date,
			),
	};
}

/** An undo brings the income back with the rates it was booked at, never today's. */
function restoredPrice(restore: IncomeRestore, home: string): Priced {
	return {
		exchangeRate: restore.exchangeRate,
		amountInUSD: restore.amountInUSD,
		booked:
			restore.homeAmount !== null && restore.homeCurrency === home
				? dec(restore.homeAmount)
				: null,
		units: restore.units === null ? null : dec(restore.units),
	};
}

/** Units the budget already counts: what the deleted leg still counted on an undo, else the arrival rule (D4). */
function countedUnitsOf(
	input: AddIncomeInput,
	account: AccountRow,
	kept: boolean,
	home: string,
	units: Decimal,
): Decimal | undefined {
	if (input.restore) {
		const counted = input.restore.countedUnits;
		return counted ? dec(counted) : undefined;
	}
	return countedOnArrival(account, kept, home) ? units : undefined;
}

export async function addIncomeIn(
	tx: Tx,
	userId: string,
	input: AddIncomeInput,
): Promise<IncomeValue> {
	const date = moveDay(input.date, new Date(), input.timeZone);
	const amount = typedAmount(input.amount, input.currency);
	if (!amount.gt(0)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Enter an amount above zero",
		});
	}
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
	const categoryId = await incomeCategory(tx, userId, input.categoryId);
	const priced = input.restore
		? restoredPrice(input.restore, home)
		: await priceIncome(tx, input, { amount, date, home, account });
	const { booked } = priced;

	const expenseId = input.id ?? randomUUID();
	const templateId = await createTemplate(tx, userId, input, {
		amount,
		date,
		categoryId,
	});
	await tx.expense.create({
		data: {
			id: expenseId,
			userId,
			title: input.title,
			amount: amount.toString(),
			currency: input.currency,
			date,
			categoryId,
			description: input.description ?? null,
			exchangeRate: priced.exchangeRate,
			amountInUSD: priced.amountInUSD,
			pricingSource: input.rateType ?? "MANUAL",
			status: "FINALIZED",
			direction: "IN",
			inType: "INCOME",
			keepInWealth: kept,
			recurringTemplateId: templateId,
		},
	});
	const units = priced.units ?? amount;
	const into = account
		? await writeLeg(tx, userId, {
				account,
				currency: account.currency,
				amount: units,
				date,
				source: "INCOME",
				expenseId,
				home: booked && { amount: booked, currency: home },
				countedUnits: countedUnitsOf(input, account, kept, home, units),
			})
		: null;
	return {
		expenseId,
		amount: amount.toString(),
		currency: input.currency,
		booked: booked && { minor: toMinor(booked, home), currency: home },
		into,
		kept,
		templateId,
	};
}

export const addIncome: MoneyMutation<AddIncomeInput, IncomeValue> = {
	id: "income.add",
	touches: INCOME_FIGURES,
	scope: (input) => (input.into ? { accountId: input.into } : {}),
	run: async (tx, input, actor) => {
		const value = await addIncomeIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "income.delete",
				rows: [
					{ table: "expense", id: value.expenseId },
					...(value.templateId
						? [{ table: "recurring_template", id: value.templateId }]
						: []),
				],
			},
		};
	},
};
