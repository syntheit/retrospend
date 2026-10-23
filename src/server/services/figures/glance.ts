/**
 * glance(): the top of Home (kit `lg.glance`, IMPLEMENTATION §5 2A.3).
 * Spent this period against the last by the same day, the budget's verdict
 * and Left to spend when a book exists, Owed to you and You owe (never
 * netted, D1) and net worth. One transaction, one load per source.
 *
 * Every number is a registered figure or comes from the same load as one:
 * glance.* (spend-pace.ts), owed.*, netWorth and budget.* are read, never
 * recomputed here.
 */
import { normalizeTimeZone } from "@retrospend/domain/time-zone";
import type { LeftToSpendDto, VerdictDto } from "~/lib/schemas/envelope";
import { userTransaction } from "~/server/db-tx";
import {
	type FigureDb,
	figures,
	readFiguresIn,
} from "~/server/figures/registry";
import { monthViewIn } from "~/server/services/envelope/month-read";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { PrismaClient } from "~prisma";
import { fasterThanLast, type IsoDate, type PeriodSpan } from "./glance-pace";
import {
	GLANCE_SPENT,
	GLANCE_SPENT_LAST,
	GLANCE_SPENT_LAST_TO_DATE,
	type GlanceFigure,
	lastToDate,
	loadSpendPace,
} from "./spend-pace";

export type GlanceBudget =
	| {
			readonly state: "ready";
			readonly verdict: VerdictDto;
			readonly leftToSpend: LeftToSpendDto;
			/** Tagged budget.notPlannedYet (signed: negative when more is planned than there is). */
			readonly notPlannedYet: GlanceFigure;
	  }
	| { readonly state: "incomplete"; readonly missingRates: string[] };

export interface GlanceDTO {
	readonly home: string;
	readonly today: IsoDate;
	readonly period: PeriodSpan & { readonly day: number };
	readonly lastPeriod: PeriodSpan;
	readonly spent: GlanceFigure;
	readonly spentLastToDate: GlanceFigure;
	readonly spentLast: GlanceFigure;
	/** Running totals in home minor units for the pace line. */
	readonly pace: {
		readonly this: readonly number[] | null;
		readonly last: readonly number[] | null;
		readonly fasterThanLast: boolean | null;
	};
	readonly owedToYou: GlanceFigure;
	readonly youOwe: GlanceFigure;
	readonly netWorth: GlanceFigure;
	/** Null without a book, with the book paused (Just track) or the budget flag off. */
	readonly budget: GlanceBudget | null;
	/** Currencies whose missing rate keeps a glance number out, named (R14). */
	readonly missingRates: readonly string[];
}

export interface GlanceOptions {
	readonly budget: boolean;
	readonly timeZone?: string;
	readonly now?: Date;
}

async function budgetPart(
	db: FigureDb,
	userId: string,
	now: Date,
): Promise<GlanceBudget | null> {
	const view = await monthViewIn(db, userId, now);
	if (!view || view.loaded.row.pausedAt) return null;
	const { dto } = view;
	if (dto.incomplete || dto.missingRates.length > 0)
		return {
			state: "incomplete",
			missingRates: [
				...new Set(dto.missingRates.map((r) => r.currency)),
			].sort(),
		};
	return {
		state: "ready",
		verdict: dto.verdict,
		leftToSpend: dto.leftToSpend,
		notPlannedYet: { id: "budget.notPlannedYet", value: dto.toAssign.amount },
	};
}

const OTHER_FIGURES = ["owed.owedToYou", "owed.youOwe", "netWorth"] as const;

export async function glanceIn(
	db: FigureDb,
	userId: string,
	options: GlanceOptions,
): Promise<GlanceDTO> {
	const now = options.now ?? new Date();
	const timeZone =
		normalizeTimeZone(options.timeZone) ?? (await userTimeZone(userId));
	const pace = await loadSpendPace(db, userId, now, timeZone);
	const readings = await readFiguresIn(
		db,
		OTHER_FIGURES.map((id) => figures.get(id)),
		{ userId },
	);
	const reading = (id: string): GlanceFigure => ({
		id,
		value: readings.get(id)?.[0] ?? null,
	});
	const budget = options.budget ? await budgetPart(db, userId, now) : null;
	const then = lastToDate(pace);
	const missing = new Set(pace.missingRates);
	if (budget?.state === "incomplete")
		for (const c of budget.missingRates) missing.add(c);
	const money = (minor: number | null) =>
		minor === null ? null : { minor, currency: pace.home };
	return {
		home: pace.home,
		today: pace.today,
		period: pace.period,
		lastPeriod: pace.last,
		spent: { id: GLANCE_SPENT, value: money(pace.thisTotal) },
		spentLastToDate: { id: GLANCE_SPENT_LAST_TO_DATE, value: money(then) },
		spentLast: { id: GLANCE_SPENT_LAST, value: money(pace.lastTotal) },
		pace: {
			this: pace.thisSeries,
			last: pace.lastSeries,
			fasterThanLast:
				pace.thisSeries && then !== null
					? fasterThanLast(pace.thisSeries.at(-1) ?? 0, then)
					: null,
		},
		owedToYou: reading("owed.owedToYou"),
		youOwe: reading("owed.youOwe"),
		netWorth: reading("netWorth"),
		budget,
		missingRates: [...missing].sort(),
	};
}

export function glance(
	db: PrismaClient,
	userId: string,
	options: GlanceOptions,
): Promise<GlanceDTO> {
	return userTransaction(db, userId, (tx) => glanceIn(tx, userId, options));
}
