/**
 * The 12 budget and envelope figures on a device (E2EE P13b): the same
 * `createBudgetFigures` the server registers, over reads that come from the
 * device's own rows and its budget snapshot. The loaders (month view, plan
 * cost, payoff projection) are the domain's, run through `storeBookSource`;
 * `src/server/figures/device-registry.pg.test.ts` holds every figure to the
 * server's reading on the same data.
 *
 * Every figure reads FigureUnavailable([]) while the budget is stale: the
 * device holds a book but no snapshot made for it as it is now, or one a
 * sync reset dropped (budget-gate.ts). With no book at all the figures read
 * null as the server's do for Just track. A value the app does not know reads
 * unavailable too.
 */

import type {
	BookRowCore,
	BookSource,
	CloseRowCore,
} from "@retrospend/domain/envelope/book-source";
import {
	type DebtSource,
	payoffFrom,
} from "@retrospend/domain/envelope/debt-read";
import type { PayoffPlanDto } from "@retrospend/domain/envelope/dto";
import { moneyInEntries } from "@retrospend/domain/envelope/entries";
import { EnvelopeError } from "@retrospend/domain/envelope/errors";
import {
	type BudgetReads,
	createBudgetFigures,
} from "@retrospend/domain/envelope/figures";
import {
	closedIncomesFrom,
	groupBaseFrom,
} from "@retrospend/domain/envelope/income-history";
import { loadBookFrom } from "@retrospend/domain/envelope/load-book";
import {
	type MonthRead,
	type MonthViewSource,
	monthViewFrom,
} from "@retrospend/domain/envelope/month-read";
import { planCostFrom } from "@retrospend/domain/envelope/plan-read";
import type { MonthKey } from "@retrospend/domain/envelope/types";
import { toMinor } from "@retrospend/domain/envelope/units";
import type {
	FigureDefinition,
	FigurePass,
} from "@retrospend/domain/figures/registry";
import { FigureUnavailable } from "@retrospend/domain/figures/unavailable";
import { dec } from "@retrospend/domain/precise-decimal";
import { BudgetUnreadable, bookOf } from "./budget-book";
import { budgetStatus } from "./budget-gate";
import {
	closedIncomeRows,
	expenseById,
	selectedRates,
	storeBookSource,
} from "./budget-source";
import { once, readNow, rowsIn } from "./pass-reads";
import type { Reader } from "./port";

/** The ids `createBudgetFigures` defines. A unit test holds this list to them. */
export const BUDGET_FIGURE_IDS: readonly string[] = [
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"budget.leftThisWeek",
	"budget.leftInLimits",
	"envelope.left",
	"envelope.spent",
	"budget.moneyIn",
	"budget.heldForOthers",
	"budget.holds",
	"budget.planCost",
	"budget.typicalIncome",
	"budget.totalDebt",
];

type Source = BookSource<BookRowCore, CloseRowCore>;

function monthSourceOf(
	db: Reader,
	pass: FigurePass | undefined,
	src: Source,
): MonthViewSource {
	const closedIncomes = (loaded: Parameters<typeof closedIncomesFrom>[1]) =>
		closedIncomesFrom(async (w) => closedIncomeRows(db, pass, w), loaded);
	return {
		// The load's fresh values and stale mark are dropped: a device writes nothing.
		loadBook: async (ctx) => (await loadBookFrom(src, ctx))?.loaded ?? null,
		groupBase: (loaded, month: MonthKey) =>
			groupBaseFrom(() => closedIncomes(loaded), loaded, month),
		startingBalanceEntry: async (loaded, id) => {
			const row = expenseById(db, id);
			return row ? moneyInEntries([row], loaded.valuer)[0] : undefined;
		},
	};
}

/** The device's payoff plan source: the book's plan row, or Avalanche with no extra. */
function debtSourceOf(db: Reader, pass: FigurePass | undefined): DebtSource {
	const book = () => {
		const row = bookOf(db, pass);
		if (!row?.defaultEnvelopeId)
			throw new EnvelopeError("NO_BOOK", "start a budget first");
		return row;
	};
	return {
		async book() {
			const row = book();
			return {
				currency: row.currency,
				timeZone: row.timeZone,
				periods: rowsIn(db, pass, "bookPeriods")
					.filter((p) => p.bookId === row.id)
					.sort((a, b) => a.fromMonth - b.fromMonth)
					.map((p) => ({
						fromMonth: p.fromMonth,
						startDay: p.startDay,
						rateType: p.rateType,
					})),
			};
		},
		async savedPlan(): Promise<PayoffPlanDto> {
			const row = book();
			const plan = rowsIn(db, pass, "payoffPlans").find(
				(p) => p.bookId === row.id,
			);
			if (!plan)
				return {
					strategy: "AVALANCHE",
					extraMonthly: { minor: 0, currency: row.currency },
					customOrder: [],
					envelopeId: null,
				};
			const { strategy } = plan;
			if (
				strategy !== "SNOWBALL" &&
				strategy !== "AVALANCHE" &&
				strategy !== "CUSTOM"
			)
				throw new BudgetUnreadable("A payoff strategy is unknown");
			return {
				strategy,
				extraMonthly: {
					minor: toMinor(plan.extraMonthly, row.currency),
					currency: row.currency,
				},
				customOrder: [...plan.customOrder],
				envelopeId: plan.envelopeId,
			};
		},
		// Open liabilities, oldest first, as the server lists them.
		async liabilities() {
			return rowsIn(db, pass, "accounts")
				.filter((a) => a.type.startsWith("LIABILITY_") && a.closedAt === null)
				.sort(
					(a, b) =>
						a.createdAt.getTime() - b.createdAt.getTime() ||
						(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
				)
				.map((a) => ({
					id: a.id,
					currency: a.currency,
					balance: dec(a.balance),
					interestRate: a.interestRate == null ? null : dec(a.interestRate),
					minimumPayment:
						a.minimumPayment == null ? null : dec(a.minimumPayment),
					dueDate: a.dueDate ?? null,
				}));
		},
		rateRows: (p) => selectedRates(db, pass, p),
	};
}

/**
 * The device's budget reads, each loaded once per pass. Like the server's,
 * each is null without a book or while a rate is missing (R14). Not stale: the
 * figure definitions in `budgetDeviceFigures` answer that before they read.
 */
export function deviceBudgetReads(clock: () => Date): BudgetReads<Reader> {
	const view = async (
		db: Reader,
		userId: string,
		pass: FigurePass | undefined,
		month?: MonthKey,
	): Promise<MonthRead | null> => {
		// The month view of the current month is the same read whether it is asked
		// for by name or not: a device has no checkpoint for `needFrom` to move, so
		// the plan cost's second look at this month reuses the first.
		if (month !== undefined) {
			const current = await view(db, userId, pass);
			if (current && current.loaded.input.currentMonth === month)
				return current;
		}
		return once(
			pass,
			month === undefined
				? `budget.month:${userId}`
				: `budget.month:${userId}:${month}`,
			async () => {
				const now = await readNow(clock, pass);
				const src = storeBookSource(db, { userId, pass });
				return monthViewFrom(monthSourceOf(db, pass, src), now, month);
			},
		);
	};

	return {
		async month(db, userId, pass) {
			const v = await view(db, userId, pass);
			return v && !v.dto.incomplete ? v : null;
		},

		async plan(db, userId, pass) {
			const read = async () => {
				if (!(await view(db, userId, pass))) return null;
				return planCostFrom(
					{
						view: (month) => view(db, userId, pass, month),
						closedIncomes: (loaded) =>
							closedIncomesFrom(
								async (w) => closedIncomeRows(db, pass, w),
								loaded,
							),
					},
					{},
				);
			};
			const v = await once(pass, `budget.plan:${userId}`, read);
			return v && !v.incomplete ? v : null;
		},

		async debt(db, userId, pass) {
			const read = async () => {
				if (!(await view(db, userId, pass))) return null;
				return payoffFrom(
					debtSourceOf(db, pass),
					{},
					await readNow(clock, pass),
				);
			};
			const v = await once(pass, `budget.debt:${userId}`, read);
			return v && !v.incomplete ? v : null;
		},
	};
}

/**
 * The 12 figures for the device registry: the shared definitions behind the
 * stale check, and a value the app cannot read answers unavailable.
 */
export function budgetDeviceFigures(
	clock: () => Date,
): FigureDefinition<Reader>[] {
	return createBudgetFigures(deviceBudgetReads(clock)).map((figure) => ({
		...figure,
		compute: async (db, scope, pass) => {
			if (budgetStatus(db, pass) === "stale") return new FigureUnavailable([]);
			try {
				return await figure.compute(db, scope, pass);
			} catch (error) {
				if (error instanceof BudgetUnreadable) return new FigureUnavailable([]);
				throw error;
			}
		},
	}));
}
