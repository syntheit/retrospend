/**
 * The Recurring tab read (recurring.listView): every template with its due
 * state, Money amounts, the next date after a confirm, the summary line
 * ("cost ARS X a month", per period) and this month's logged entries. The
 * server computes every number (R9); a template whose currency has no rate
 * is named in the summary and left out of it, never counted as zero (B16).
 *
 * This file is the server loader: it reads the templates and rates with SQL
 * and hands them to the pure compute in @retrospend/domain/recurring-view,
 * which a device runs over its own rows.
 */

import {
	type RecurringBody,
	type RecurringInputs,
	recurringBodyFrom,
	recurringRateCurrencies,
} from "@retrospend/domain/recurring-view";
import { USD } from "@retrospend/domain/money";
import {
	fromWallTime,
	normalizeTimeZone,
	wallTime,
} from "@retrospend/domain/time-zone";
import { userTransaction } from "~/server/db-tx";
import { findExchangeRatesForDates } from "~/server/exchange-rates";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { Prisma, PrismaClient } from "~prisma";
import type { HomeRates } from "./expense-list/money";
import { shapeRows } from "./expense-list/rows";
import type { ActivityRowDTO } from "./expense-list/types";

export type {
	RecurringBody,
	RecurringCost,
	RecurringFrequencyDTO,
	RecurringItemDTO,
} from "@retrospend/domain/recurring-view";

type Db = PrismaClient | Prisma.TransactionClient;

export type RecurringView = RecurringBody & {
	/**
	 * This month's entries logged from a template, by auto-pay or a Confirm:
	 * rows do not record which, so the section says "Logged this month".
	 */
	logged: ActivityRowDTO[];
};

async function loggedThisMonth(
	tx: Prisma.TransactionClient,
	userId: string,
	rates: HomeRates,
	timeZone: string | undefined,
	now: Date,
): Promise<ActivityRowDTO[]> {
	const { year, month } = wallTime(now, timeZone);
	const rows = await tx.expense.findMany({
		where: {
			userId,
			recurringTemplateId: { not: null },
			date: { gte: fromWallTime({ year, month, day: 1 }, timeZone), lte: now },
		},
		orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
		select: { id: true, date: true, createdAt: true },
		take: 20,
	});
	return shapeRows(
		tx,
		rows.map((r) => ({
			src: "p" as const,
			id: r.id,
			date: r.date,
			created: r.createdAt,
		})),
		{ userId, timeZone, rates },
	);
}

/**
 * The server loader: the user's templates in page order with their categories,
 * the home currency, and each currency's rate on `now`.
 */
export async function loadRecurringInputs(
	tx: Prisma.TransactionClient,
	userId: string,
	now: Date,
): Promise<RecurringInputs> {
	const [user, templates] = await Promise.all([
		tx.user.findUnique({
			where: { id: userId },
			select: { homeCurrency: true },
		}),
		tx.recurringTemplate.findMany({
			where: { userId },
			orderBy: [{ nextDueDate: "asc" }, { id: "asc" }],
			include: {
				category: {
					select: { id: true, name: true, color: true, icon: true },
				},
			},
		}),
	]);
	const home = user?.homeCurrency ?? USD;
	const currencies = recurringRateCurrencies(home, templates);
	const lookup = await findExchangeRatesForDates(tx, currencies);
	return {
		home,
		templates,
		rates: Object.fromEntries(
			currencies.map((c) => [c, lookup(c, now)?.rate ?? null]),
		),
	};
}

/**
 * The templates and costs of `userId` through an open transaction: what the
 * recurring figures read, so the page and the figures share one computation.
 */
export async function readRecurringBody(
	tx: Prisma.TransactionClient,
	userId: string,
	requestZone: string | undefined,
	now: Date,
): Promise<RecurringBody & { rates: HomeRates }> {
	// Due dates step in the user's zone, so there is always one (no process zone).
	const timeZone = await userTimeZone(tx, userId, requestZone);
	// Due dates step in the saved zone, while days are shown in the request's.
	const stepZone = requestZone ? await userTimeZone(tx, userId) : timeZone;
	return recurringBodyFrom({
		inputs: await loadRecurringInputs(tx, userId, now),
		now,
		timeZone,
		stepZone,
	});
}

export async function listRecurringView(
	db: Db,
	userId: string,
	requestZone?: string,
	now: Date = new Date(),
): Promise<RecurringView> {
	return userTransaction(db as PrismaClient, userId, async (tx) => {
		const timeZone = await userTimeZone(
			tx,
			userId,
			normalizeTimeZone(requestZone),
		);
		const { rates, ...body } = await readRecurringBody(
			tx,
			userId,
			timeZone,
			now,
		);
		return {
			...body,
			logged: await loggedThisMonth(tx, userId, rates, timeZone, now),
		};
	});
}
