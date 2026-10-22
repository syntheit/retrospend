/**
 * Runs every reader of spending for one fixture user and returns what each
 * one shows, without row ids, so two users seeded with the same ledger can be
 * compared reader by reader. The pg test files that import this must mock
 * `~/server/better-auth` (the tRPC module imports it).
 */

import { categoriesRouter } from "~/server/api/routers/categories";
import { dashboardRouter } from "~/server/api/routers/dashboard";
import { expenseRouter } from "~/server/api/routers/expense";
import { profileRouter } from "~/server/api/routers/profile";
import { statsRouter } from "~/server/api/routers/stats";
import { wealthRouter } from "~/server/api/routers/wealth";
import { createCallerFactory } from "~/server/api/trpc";
import { getBudgets, getSuggestions } from "~/server/services/budget.service";
import {
	getOverviewSettings,
	getOverviewStats,
} from "~/server/services/overview.service";
import { RateCache } from "~/server/services/rate-cache";
import {
	getExcludedProjectIds,
	getSharedExpenseShares,
} from "~/server/services/shared-expense-integration";
import { getSpendingTotal } from "~/server/services/spending";
import { StatsService } from "~/server/services/stats.service";
import { TIME_ZONE_HEADER } from "~/server/time-zone";
import { adminDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import {
	APRIL,
	HOME,
	MARCH,
	type SpendingFixture,
	TZ,
} from "./spending-fixture";

const iso = (d: Date) => d.toISOString();

function callers(userId: string) {
	const ctx = {
		session: makeSession({ id: userId }),
		db: adminDb,
		headers: new Headers({ [TIME_ZONE_HEADER]: TZ }),
	};
	return {
		dashboard: createCallerFactory(dashboardRouter)(ctx),
		expense: createCallerFactory(expenseRouter)(ctx),
		profile: createCallerFactory(profileRouter)(ctx),
		stats: createCallerFactory(statsRouter)(ctx),
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
	const stats = new StatsService(db as never, undefined, excluded, TZ);
	const overview = async (month: Date) =>
		getOverviewStats(db as never, userId, {
			...(await getOverviewSettings(db as never, userId)),
			month,
			homeCurrency: HOME,
			excludedProjectIds: excluded,
			rateCache: new RateCache(db as never),
			timeZone: TZ,
		});
	const budgets = await getBudgets(db as never, userId, MARCH, {
		includeGlobal: true,
		excludedProjectIds: excluded,
		homeCurrency: HOME,
		timeZone: TZ,
	});
	const shares = await getSharedExpenseShares(
		db,
		userId,
		undefined,
		undefined,
		excluded,
	);
	return {
		summary: await stats.getSummaryStats(userId, MARCH, HOME),
		breakdown: (await stats.getCategoryBreakdown(userId, MARCH, HOME)).map(
			(c) => [c.name, c.value],
		),
		trend: (await stats.getDailyTrend(userId, MARCH, HOME)).map((d) => [
			d.day,
			d.total,
			d.fixed,
			d.variable,
		]),
		lifetime: await stats.getLifetimeStats(userId, HOME),
		overviewMarch: await overview(MARCH),
		overviewApril: await overview(APRIL),
		budgets: budgets
			.map((b) => [
				b.category?.name ?? null,
				b.actualSpend,
				b.actualSpendInHome,
			])
			.sort(),
		suggestions: await getSuggestions(
			db as never,
			userId,
			fixture.groceries.id,
			HOME,
			1,
			TZ,
		),
		spendingTotalMarch: await getSpendingTotal(
			db,
			userId,
			{
				gte: new Date("2026-03-01T00:00:00.000Z"),
				lte: new Date("2026-03-31T23:59:59.999Z"),
			},
			HOME,
			1000,
			excluded,
		),
		shares: shares.map((s) => [s.amount, s.currency, iso(s.date)]).sort(),
	};
}

async function routerReaders(fixture: SpendingFixture) {
	const c = callers(fixture.userId);
	const overviewData = await c.dashboard.getOverviewData({
		month: MARCH,
		homeCurrency: HOME,
	});
	const recent = await c.dashboard.getRecentActivity({ homeCurrency: HOME });
	const listed = await c.expense.listFinalized();
	const byDate = await c.expense.getExpensesByDate({
		date: new Date("2026-03-05T12:00:00.000Z"),
	});
	const { csv } = await c.expense.exportCsv();
	return {
		dashboard: {
			hasExpenses: overviewData.hasExpenses,
			monthTotal: overviewData.overviewStats.monthTotal,
			summary: overviewData.summaryStats,
			categories: overviewData.categoryData.map((x) => [x.name, x.value]),
			trendEnd: overviewData.trendData.at(-1),
		},
		recent: recent.map((r) => [r.type, r.title, r.amount, r.currency]),
		statsSummary: await c.stats.getSummary({
			month: MARCH,
			homeCurrency: HOME,
		}),
		statsLifetime: await c.stats.getLifetimeStats({ homeCurrency: HOME }),
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
		csvLines: csv.trim().split("\n").length,
		categories: (await c.categories.getAll()).map((x) => x.name),
	};
}

export async function readAllSpendingReaders(fixture: SpendingFixture) {
	return {
		...(await serviceReaders(fixture)),
		...(await routerReaders(fixture)),
	};
}
