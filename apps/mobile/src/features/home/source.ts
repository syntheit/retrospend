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
}

export const HOME_CACHE: CacheKey = { name: "home", schema: 2 };
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
		};
	};
}

/**
 * The one big number: Left to spend when there is a budget with a verdict
 * (or how far over, in the verdict's own words, once it is over), else what
 * was spent this period. All are the server's figures.
 */
type ReadyBudget = Extract<NonNullable<Glance["budget"]>, { state: "ready" }>;

export type Hero =
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
	  }
	| { kind: "spent"; amount: Money | null; lastToDate: Money | null };

export function heroOf(glance: Glance): Hero {
	const budget = glance.budget;
	if (budget?.state === "ready") {
		const { leftToSpend, verdict } = budget;
		if (verdictIsOver(verdict)) {
			return { kind: "over", verdict, amount: verdict.lead.amount };
		}
		return {
			kind: "left",
			amount: leftToSpend.left,
			perDay: leftToSpend.perDay,
			daysLeft: leftToSpend.daysLeft,
			spent: leftToSpend.spent,
		};
	}
	return {
		kind: "spent",
		amount: glance.spent.value,
		lastToDate: glance.spentLastToDate.value,
	};
}
