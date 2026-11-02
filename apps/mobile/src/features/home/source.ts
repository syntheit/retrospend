import type { RetrospendClient } from "@retrospend/api-client";
import type { Money } from "@retrospend/domain/money-minor";
import type { ActivityPage } from "@/features/activity/source";
import { verdictIsOver } from "@/features/budget/verdict";
import { approxSides } from "@/features/people/groups";
import type { CacheKey } from "@/features/read/loadCached";
import type { NeedsYouList } from "./needs";

export type Glance = Awaited<ReturnType<RetrospendClient["figures"]["glance"]>>;

export interface HomeData {
	glance: Glance;
	needs: NeedsYouList;
	/** The newest few entries, for Recent. */
	recent: ActivityPage;
	/** Which owed totals are converted at reference rates (shown with "≈"). */
	approx: { owedToYou: boolean; youOwe: boolean };
	/** The people who owe you, in the server's order, for the faces on Owed to you. */
	owers: { key: string; name: string; imageUrl: string | null }[];
}

export const HOME_CACHE: CacheKey = { name: "home", schema: 3 };
// Per-phone choice, kept across builds (STICKY_CACHE_NAMES in data/cache.ts).
export const SNOOZE_CACHE: CacheKey = { name: "home.later", schema: 1 };
export const RECENT_COUNT = 5;

export function fetchHome(api: RetrospendClient) {
	return async (): Promise<HomeData> => {
		const [glance, needs, recent, people] = await Promise.all([
			api.figures.glance(),
			api["needs-you"].list(),
			api.expenses.list({ limit: RECENT_COUNT }),
			api.people.list(),
		]);
		return {
			glance,
			needs,
			recent,
			approx: approxSides(people.people, people.home),
			owers: people.people
				.filter((p) => p.group === "owed")
				.map(({ person: { key, name, imageUrl } }) => ({
					key,
					name,
					imageUrl,
				})),
		};
	};
}

/**
 * The one big number, as the web glance leads: what was spent this period,
 * with how it compares to last month by this day. Budget status is its own
 * part (`budgetStatusOf`). All are the server's figures.
 */
export interface Spent {
	/** Null when a rate is missing: Home says so, never a guess. */
	amount: Money | null;
	lastToDate: Money | null;
	/** The server's pace verdict against last month by this day; null while there is no pace. */
	fasterThanLast: boolean | null;
	/** A day in last month, for naming it. */
	lastMonth: string;
}

export function spentOf(glance: Glance): Spent {
	return {
		amount: glance.spent.value,
		lastToDate: glance.spentLastToDate.value,
		fasterThanLast: glance.pace.fasterThanLast,
		lastMonth: glance.lastPeriod.from,
	};
}

type ReadyBudget = Extract<NonNullable<Glance["budget"]>, { state: "ready" }>;

/** The budget part's status: what is left to spend, or how far over, in the verdict's words. */
export type BudgetStatus =
	| {
			kind: "left";
			amount: Money;
			perDay: Money;
			daysLeft: number;
			spent: Money;
	  }
	| {
			/** Over budget: the verdict words it (how far over), never a minus sign. */
			kind: "over";
			verdict: ReadyBudget["verdict"];
			amount: Money;
	  };

/** Null without a ready budget (none set, paused, or a rate missing). */
export function budgetStatusOf(glance: Glance): BudgetStatus | null {
	const budget = glance.budget;
	if (budget?.state !== "ready") return null;
	const { leftToSpend, verdict } = budget;
	if (verdictIsOver(verdict)) {
		return { kind: "over", verdict, amount: verdict.lead.amount };
	}
	// As the web glance does: any `over` figure means over, whatever state
	// the verdict is in, and Left to spend is never shown below zero.
	const over =
		verdict.style === "LIMITS" && verdict.over.minor > 0
			? verdict.over
			: leftToSpend.over.minor > 0
				? leftToSpend.over
				: leftToSpend.left.minor < 0
					? {
							minor: -leftToSpend.left.minor,
							currency: leftToSpend.left.currency,
						}
					: null;
	if (over) {
		return {
			kind: "over",
			verdict: {
				...verdict,
				state: "OVER_BUDGET",
				lead: { ...verdict.lead, amount: over },
			},
			amount: over,
		};
	}
	return {
		kind: "left",
		amount: leftToSpend.left,
		perDay: leftToSpend.perDay,
		daysLeft: leftToSpend.daysLeft,
		spent: leftToSpend.spent,
	};
}

/**
 * Money that has no job yet, when there is some: the amount and what the
 * plan calls it ("Not planned yet", or "To assign" in a plan that says so).
 * Zero, a negative (planned more than there is, which the verdict words) and
 * a missing rate are all nothing to show.
 */
export function notPlannedOf(glance: Glance): {
	amount: Money;
	pool: "NOT_PLANNED_YET" | "TO_ASSIGN";
} | null {
	const budget = glance.budget;
	if (budget?.state !== "ready") return null;
	const amount = budget.notPlannedYet.value;
	if (!amount || amount.minor <= 0) return null;
	return { amount, pool: budget.verdict.poolName };
}
