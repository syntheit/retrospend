import { TRPCError } from "@trpc/server";
import {
	insightsCashflow,
	insightsMonths,
	insightsSummary,
	insightsYtd,
} from "~/server/services/insights";
import type { InsightsFilter } from "~/server/services/insights/types";
import type { LedgerCaller } from "./money-op";

/**
 * The web's Insights reads behind GET /figures/insights/*: each calls the
 * same service as the tRPC procedure, in the caller's time zone. The chips
 * arrive as the /expenses filter's comma-separated lists.
 */

type FilterQuery = { cat?: string; person?: string; project?: string };
type SpanQuery = { from: string; to: string };

const list = (v: string | undefined) =>
	v ? [...new Set(v.split(",").filter(Boolean))] : undefined;

export function filterOf(q: FilterQuery): InsightsFilter {
	const categoryIds = list(q.cat);
	const personKeys = list(q.person);
	const projectIds = list(q.project);
	return {
		...(categoryIds ? { categoryIds } : {}),
		...(personKeys ? { personKeys } : {}),
		...(projectIds ? { projectIds } : {}),
	};
}

function spanOf(q: SpanQuery) {
	if (q.from > q.to)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The range must start on or before the day it ends",
		});
	return { from: q.from, to: q.to };
}

const zone = (caller: LedgerCaller) => ({ timeZone: caller.timeZone });

export const readInsightsSummary = (
	caller: LedgerCaller,
	q: SpanQuery & FilterQuery & { compare?: "true" | "false" },
) =>
	insightsSummary(
		caller.db,
		caller.principal.userId,
		{ range: spanOf(q), compare: q.compare === "true", filter: filterOf(q) },
		zone(caller),
	);

export const readInsightsMonths = (
	caller: LedgerCaller,
	q: FilterQuery & { to: string; count: number },
) =>
	insightsMonths(
		caller.db,
		caller.principal.userId,
		{ to: q.to, count: q.count, filter: filterOf(q) },
		zone(caller),
	);

export const readInsightsYtd = (caller: LedgerCaller, q: FilterQuery) =>
	insightsYtd(
		caller.db,
		caller.principal.userId,
		{ filter: filterOf(q) },
		zone(caller),
	);

export const readInsightsCashflow = (caller: LedgerCaller, q: SpanQuery) =>
	insightsCashflow(
		caller.db,
		caller.principal.userId,
		{ range: spanOf(q) },
		zone(caller),
	);
