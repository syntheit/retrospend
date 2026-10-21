/**
 * Dashboard overview stats (month total, budget pace, work equivalent) in the
 * home currency. Totals follow the totals rule in ~/lib/money; the budget
 * figures come from the budget service's *InHome fields, so the dashboard and
 * the budget page agree.
 */
import {
	getFiscalMonthProgress,
	getFiscalMonthRange,
} from "~/lib/fiscal-month";
import { convertAmount, periodRateDate, sumIn } from "~/lib/money";
import type { db as AppDb } from "~/server/db";
import * as BudgetService from "./budget.service";
import type { RateCache } from "./rate-cache";
import { getSpendingItems } from "./spending";

/** Category names treated as "fixed" for budget pacing calculations */
const FIXED_CATEGORY_NAMES = ["rent", "utilities", "mortgage", "bills", "insurance"];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OverviewOptions {
	month: Date;
	homeCurrency: string;
	fiscalStartDay: number;
	monthlyIncome: number;
	monthlyIncomeCurrency: string;
	excludedProjectIds?: string[];
	rateCache: RateCache;
	timeZone?: string;
	now?: Date;
}

export async function getOverviewStats(
	db: typeof AppDb,
	userId: string,
	options: OverviewOptions,
) {
	const {
		month,
		homeCurrency,
		fiscalStartDay,
		excludedProjectIds,
		rateCache,
		timeZone,
	} = options;
	const now = options.now ?? new Date();

	const fiscal = getFiscalMonthRange(month, fiscalStartDay, timeZone);
	const progress = getFiscalMonthProgress(now, month, fiscalStartDay, timeZone);
	const isCurrentMonth = progress.isCurrentPeriod;

	const homeRate = await rateCache.rate(
		homeCurrency,
		periodRateDate(fiscal.end, now),
	);

	const [monthItems, last24HoursItems, budgets] = await Promise.all([
		getSpendingItems(
			db,
			userId,
			{ gte: fiscal.start, lte: fiscal.end },
			excludedProjectIds,
		),
		isCurrentMonth
			? getSpendingItems(
					db,
					userId,
					{ gte: new Date(now.getTime() - DAY_MS) },
					excludedProjectIds,
				)
			: Promise.resolve([]),
		BudgetService.getBudgets(db, userId, month, {
			includeGlobal: true,
			fiscalMonthStartDay: fiscalStartDay,
			rateCache,
			excludedProjectIds,
			homeCurrency,
			timeZone,
		}),
	]);

	// Everything the user spent this month, budgeted or not.
	const monthTotal = sumIn(monthItems, homeCurrency, homeRate);
	const last24Hours = isCurrentMonth
		? sumIn(
				last24HoursItems,
				homeCurrency,
				await rateCache.rate(homeCurrency, now),
			)
		: 0;

	// Budget pace: compares budgets with spending in budgeted categories (or
	// all spending when there is a global budget).
	const globalBudget = budgets.find((b) => b.categoryId === null);
	const categoryBudgets = budgets.filter((b) => b.categoryId !== null);
	const isFixed = (b: BudgetService.BudgetWithStats) =>
		b.category?.isFixed ||
		FIXED_CATEGORY_NAMES.includes(b.category?.name.toLowerCase() ?? "");
	const sum = (
		list: BudgetService.BudgetWithStats[],
		pick: (b: BudgetService.BudgetWithStats) => number,
	) => list.reduce((total, b) => total + pick(b), 0);

	const globalBudgetLimit = globalBudget?.effectiveAmountInHome ?? 0;
	const fixedBudgetsSum = sum(
		categoryBudgets.filter(isFixed),
		(b) => b.effectiveAmountInHome,
	);
	const explicitVariableBudgetsSum = sum(
		categoryBudgets.filter((b) => !isFixed(b)),
		(b) => b.effectiveAmountInHome,
	);
	const peggedAdjustment = sum(
		categoryBudgets.filter((b) => b.type === "PEG_TO_ACTUAL" || b.pegToActual),
		(b) => b.actualSpendInHome,
	);

	const totalBudget =
		globalBudgetLimit > 0
			? globalBudgetLimit + peggedAdjustment
			: fixedBudgetsSum + explicitVariableBudgetsSum;

	const residualVariableBudget = Math.max(0, totalBudget - fixedBudgetsSum);
	let variableBudget =
		explicitVariableBudgetsSum > 0
			? explicitVariableBudgetsSum
			: residualVariableBudget;
	if (variableBudget === 0 && totalBudget > 0) {
		variableBudget = totalBudget;
	}

	const budgetedSpent = globalBudget
		? monthTotal
		: sum(categoryBudgets, (b) => b.actualSpendInHome);
	const variableSpent = sum(
		categoryBudgets.filter((b) => !isFixed(b)),
		(b) => b.actualSpendInHome,
	);

	const rawIncome = options.monthlyIncome;
	const incomeCurrency = options.monthlyIncomeCurrency;
	let monthlyIncome = rawIncome;
	if (rawIncome > 0 && incomeCurrency !== homeCurrency) {
		const incomeRate = await rateCache.rate(
			incomeCurrency,
			periodRateDate(fiscal.end, now),
		);
		monthlyIncome = convertAmount(
			rawIncome,
			incomeCurrency,
			incomeRate,
			homeCurrency,
			homeRate,
		);
	}

	return {
		last24Hours,
		isCurrentMonth,
		monthTotal,
		dailyBudgetPace: {
			totalBudget,
			totalSpent: budgetedSpent,
			variableBudget: variableBudget || totalBudget,
			variableSpent,
			daysRemaining: progress.daysRemaining,
		},
		workEquivalent: {
			totalSpent: monthTotal,
			monthlyIncome,
		},
	};
}

/** The user settings getOverviewStats needs. */
export async function getOverviewSettings(db: typeof AppDb, userId: string) {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: {
			fiscalMonthStartDay: true,
			monthlyIncome: true,
			monthlyIncomeCurrency: true,
		},
	});
	return {
		fiscalStartDay: user?.fiscalMonthStartDay ?? 1,
		monthlyIncome: Number(user?.monthlyIncome ?? 0),
		monthlyIncomeCurrency: user?.monthlyIncomeCurrency ?? "USD",
	};
}
