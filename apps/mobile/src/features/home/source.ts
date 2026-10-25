import type { RetrospendClient } from "@retrospend/api-client";
import type { Money } from "@retrospend/domain/money-minor";
import type { ActivityPage } from "@/features/activity/source";
import type { CacheKey } from "@/features/read/loadCached";
import type { NeedsYouList } from "./needs";

export type Glance = Awaited<ReturnType<RetrospendClient["figures"]["glance"]>>;

export interface HomeData {
	glance: Glance;
	needs: NeedsYouList;
	/** The newest few entries, for Recent. */
	recent: ActivityPage;
}

export const HOME_CACHE: CacheKey = { name: "home", schema: 1 };
export const SNOOZE_CACHE: CacheKey = { name: "home.later", schema: 1 };
export const RECENT_COUNT = 5;

export function fetchHome(api: RetrospendClient) {
	return async (): Promise<HomeData> => {
		const [glance, needs, recent] = await Promise.all([
			api.figures.glance(),
			api["needs-you"].list(),
			api.expenses.list({ limit: RECENT_COUNT }),
		]);
		return { glance, needs, recent };
	};
}

/**
 * The one big number: Left to spend when there is a budget with a verdict,
 * else what was spent this period. Both are the server's figures.
 */
export type Hero =
	| {
			kind: "left";
			amount: Money;
			perDay: Money;
			daysLeft: number;
			spent: Money;
	  }
	| { kind: "spent"; amount: Money | null; lastToDate: Money | null };

export function heroOf(glance: Glance): Hero {
	const budget = glance.budget;
	if (budget?.state === "ready") {
		const { leftToSpend } = budget;
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
