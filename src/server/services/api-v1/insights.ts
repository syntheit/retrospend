import type {
	insightsCashflowSchema,
	insightsMonthsSchema,
	insightsSummarySchema,
	insightsYtdSchema,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
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

/*
 * The services answer readonly DTOs and the wire types are the contract's
 * mutable ones. The shape is the same (the pg test parses every answer with
 * its schema), so the casts below only drop `readonly`.
 */

export async function readInsightsSummary(
	caller: LedgerCaller,
	q: SpanQuery & FilterQuery & { compare?: "true" | "false" },
) {
	const dto = await insightsSummary(
		caller.db,
		caller.principal.userId,
		{ range: spanOf(q), compare: q.compare === "true", filter: filterOf(q) },
		zone(caller),
	);
	return dto as z.output<typeof insightsSummarySchema>;
}

export async function readInsightsMonths(
	caller: LedgerCaller,
	q: FilterQuery & { to: string; count: number },
) {
	const dto = await insightsMonths(
		caller.db,
		caller.principal.userId,
		{ to: q.to, count: q.count, filter: filterOf(q) },
		zone(caller),
	);
	return dto as z.output<typeof insightsMonthsSchema>;
}

export async function readInsightsYtd(caller: LedgerCaller, q: FilterQuery) {
	const dto = await insightsYtd(
		caller.db,
		caller.principal.userId,
		{ filter: filterOf(q) },
		zone(caller),
	);
	return dto as z.output<typeof insightsYtdSchema>;
}

export async function readInsightsCashflow(caller: LedgerCaller, q: SpanQuery) {
	const dto = await insightsCashflow(
		caller.db,
		caller.principal.userId,
		{ range: spanOf(q) },
		zone(caller),
	);
	return dto as z.output<typeof insightsCashflowSchema>;
}
