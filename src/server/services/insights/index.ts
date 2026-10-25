/**
 * Insights reads (IMPLEMENTATION §5 2E.4; mockup selectors `D.spent`,
 * `D.months`, year to date, compare). Each opens one RLS transaction and
 * runs the read of its own file, so a user only ever sees their own rows.
 */
import { userTransaction } from "~/server/db-tx";
import type { PrismaClient } from "~prisma";
import { cashflowIn } from "./cashflow";
import { firstDayIn } from "./first-day";
import { monthsIn } from "./months";
import { summaryIn } from "./summary";
import type {
	CashflowDTO,
	InsightsFilter,
	MonthsDTO,
	SummaryDTO,
	YtdDTO,
} from "./types";
import { ytdIn } from "./ytd";

type Span = { readonly from: string; readonly to: string };
interface Options {
	/** The request's zone; else the user's stored zone, else the server default. */
	readonly timeZone?: string;
	readonly now?: Date;
}

export const insightsSummary = (
	db: PrismaClient,
	userId: string,
	input: { range: Span; compare: boolean; filter?: InsightsFilter },
	options?: Options,
): Promise<SummaryDTO> =>
	userTransaction(db, userId, (tx) => summaryIn(tx, userId, input, options));

export const insightsMonths = (
	db: PrismaClient,
	userId: string,
	input: { to: string; count?: number; filter?: InsightsFilter },
	options?: Options,
): Promise<MonthsDTO> =>
	userTransaction(db, userId, (tx) => monthsIn(tx, userId, input, options));

export const insightsYtd = (
	db: PrismaClient,
	userId: string,
	input: { filter?: InsightsFilter },
	options?: Options,
): Promise<YtdDTO> =>
	userTransaction(db, userId, (tx) => ytdIn(tx, userId, input, options));

export const insightsCashflow = (
	db: PrismaClient,
	userId: string,
	input: { range: Span },
	options?: Options,
): Promise<CashflowDTO> =>
	userTransaction(db, userId, (tx) => cashflowIn(tx, userId, input, options));

/** Where All time starts: the day of the oldest spending, or null with none. */
export const insightsFirstDay = (
	db: PrismaClient,
	userId: string,
	options?: Options,
): Promise<{ readonly day: string | null }> =>
	userTransaction(db, userId, (tx) => firstDayIn(tx, userId, options));
