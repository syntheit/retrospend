/**
 * Runs every reader of spending for one fixture user and returns what each
 * one shows, without row ids, so two users seeded with the same ledger can be
 * compared reader by reader. The pg test files that import this must mock
 * `~/server/better-auth` (the tRPC module imports it).
 */

import { categoriesRouter } from "~/server/api/routers/categories";
import { expenseRouter } from "~/server/api/routers/expense";
import { profileRouter } from "~/server/api/routers/profile";
import { wealthRouter } from "~/server/api/routers/wealth";
import { createCallerFactory } from "~/server/api/trpc";
import { readFigures } from "~/server/figures/read";
import { spentIn } from "~/server/services/figures/spent";
import {
	getExcludedProjectIds,
	getSharedExpenseShares,
} from "~/server/services/shared-expense-integration";
import { StatsService } from "~/server/services/stats.service";
import { TIME_ZONE_HEADER } from "~/server/time-zone";
import { adminDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { HOME, type SpendingFixture, TZ } from "./spending-fixture";

const iso = (d: Date) => d.toISOString();

/** A spending entry no ledger row has; the leak test gives one user money in with exactly this shape. */
export const MONEY_IN_PROBE = {
	title: "Payroll",
	amount: 777,
	date: new Date("2026-03-07T12:00:00.000Z"),
};

export function callers(userId: string) {
	const ctx = {
		session: makeSession({ id: userId }),
		db: adminDb,
		headers: new Headers({ [TIME_ZONE_HEADER]: TZ }),
	};
	return {
		expense: createCallerFactory(expenseRouter)(ctx),
		profile: createCallerFactory(profileRouter)(ctx),
		wealth: createCallerFactory(wealthRouter)(ctx),
		categories: createCallerFactory(categoriesRouter)(ctx),
	};
}

type Listed = {
	title: string;
	amount: number;
	currency: string;
	date: Date;
};
const row = (e: Listed) => [e.title, e.amount, e.currency, iso(e.date)];

/** Services read through the user's RLS-scoped client, as protectedProcedure does. */
async function serviceReaders(fixture: SpendingFixture) {
	const { userId, db } = fixture;
	const excluded = await getExcludedProjectIds(db, userId);
	const stats = new StatsService(db as never);
	const shares = await getSharedExpenseShares(
		db,
		userId,
		undefined,
		undefined,
		excluded,
	);
	return {
		lifetime: await stats.getLifetimeStats(userId, HOME),
		spendingTotalMarch: await spentIn(
			db,
			{
				userId,
				date: {
					gte: new Date("2026-03-01T00:00:00.000Z"),
					lte: new Date("2026-03-31T23:59:59.999Z"),
				},
			},
			HOME,
			1000,
		),
		spentFigure: (await readFigures(userId, ["spent"])).get("spent"),
		shares: shares.map((s) => [s.amount, s.currency, iso(s.date)]).sort(),
	};
}

async function routerReaders(fixture: SpendingFixture) {
	const c = callers(fixture.userId);
	const listed = await c.expense.listFinalized();
	const byDate = await c.expense.getExpensesByDate({
		date: new Date("2026-03-05T12:00:00.000Z"),
	});
	const { csv } = await c.expense.exportCsv();
	return {
		profileLifetime: await c.profile
			.getLifetimeStats()
			.then(({ lifetimeSpend, totalEntries }) => ({
				lifetimeSpend,
				totalEntries,
			})),
		runway: await c.wealth.getRunwayStats({ currency: HOME }),
		listed: listed.map(row),
		byDate: byDate.map(row),
		duplicate: await c.expense.checkDuplicate({
			title: "Super Mar",
			amount: 12_000,
			date: new Date("2026-03-05T12:00:00.000Z"),
		}),
		titles: (await c.expense.titleSuggestions({ query: "Super" })).map((t) => [
			t.title,
			t.count,
			t.lastAmount,
		]),
		// Only a money-in row could match these, and none may.
		duplicateOfMoneyIn: await c.expense.checkDuplicate(MONEY_IN_PROBE),
		titlesOfMoneyIn: await c.expense.titleSuggestions({ query: "Payroll" }),
		csvLines: csv.trim().split("\n").length,
		categories: (await c.categories.getAll()).map((x) => x.name),
	};
}

/**
 * Imports the probe as an expense: money in must never make it a duplicate.
 * It writes, so it runs after every other reader.
 */
async function csvImport(fixture: SpendingFixture) {
	return callers(fixture.userId).expense.importExpenses({
		rows: [{ ...MONEY_IN_PROBE, currency: HOME }],
	});
}

export async function readAllSpendingReaders(fixture: SpendingFixture) {
	return {
		...(await serviceReaders(fixture)),
		...(await routerReaders(fixture)),
		csvImport: await csvImport(fixture),
	};
}
