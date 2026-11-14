/**
 * The 14 `insights.*` figures on a device (E2EE P6): the default view (this
 * fiscal period, no filters) read from the device's own rows through the same
 * loaders-from-rows (insights-rows) and the same picks (insights-figures) the
 * server's registry calls, so a number is never made two ways.
 * `src/server/figures/device-registry.pg.test.ts` holds each to the server's
 * reading on the same data.
 *
 * Insights prices every total at the home currency's best rate on one date
 * over all its rate rows (rateLookup, never the glance's 20-row window), so
 * the rows come from `ratesOf`, ungrouped by date. A share is priced by
 * shareRateOf over the rows of its own currency. Settings are required: a
 * store without them throws, where the server falls back to USD and day 1.
 */
import type {
	FigureDefinition,
	FigurePass,
} from "@retrospend/domain/figures/registry";
import type { Span } from "@retrospend/domain/insights";
import {
	fiscalMonthLabel,
	insightsContextOf,
	previousPeriod,
} from "@retrospend/domain/insights-compute";
import {
	cashflowPicks,
	cashflowReading,
	categoryReading,
	insightsPeriod,
	insightsYtdSpans,
	monthReading,
	spanReading,
	ytdReading,
} from "@retrospend/domain/insights-figures";
import {
	cashflowFromRows,
	monthsFromRows,
	spanReadFromRows,
	ytdSideFromRows,
} from "@retrospend/domain/insights-rows";
import { shareRateOf } from "@retrospend/domain/spent";
import {
	lookupFor,
	once,
	ratesOf,
	readNow,
	rowsIn,
	settingsOf,
} from "./pass-reads";
import type { Reader } from "./port";

type DeviceFigure = FigureDefinition<Reader>;

/** The ids of the insights figures, as the server registers them. */
const ID = {
	spent: "insights.spent",
	spentPrevious: "insights.spentPrevious",
	byCategory: "insights.byCategory",
	byMonth: "insights.byMonth",
	income: "insights.income",
	saved: "insights.saved",
	dailyAverage: "insights.dailyAverage",
	monthlyAverage: "insights.monthlyAverage",
	ytd: "insights.ytd",
	ytdLastYear: "insights.ytdLastYear",
	ytdByCategory: "insights.ytdByCategory",
	ytdUsd: "insights.ytdUsd",
	ytdLastYearUsd: "insights.ytdLastYearUsd",
	ytdByCategoryUsd: "insights.ytdByCategoryUsd",
} as const;

export const INSIGHTS_FIGURE_IDS: readonly string[] = Object.values(ID);

/** The context, period and rows every insights figure of one pass reads, loaded once. */
function viewOf(
	db: Reader,
	userId: string,
	clock: () => Date,
	pass?: FigurePass,
) {
	return once(pass, `insights:view:${userId}`, async () => {
		const s = settingsOf(db, pass);
		const now = await readNow(clock, pass);
		const ctx = insightsContextOf({
			home: s.homeCurrency,
			zone: s.timeZone,
			startDay: s.startDay,
			now,
			rateRows: ratesOf(db, pass, [s.homeCurrency])[s.homeCurrency] ?? [],
		});
		const shares = rowsIn(db, pass, "shares");
		const shareRate = shareRateOf(
			lookupFor(
				db,
				pass,
				shares.filter((x) => x.exchangeRate === null).map((x) => x.currency),
			),
		);
		return {
			ctx,
			period: insightsPeriod(ctx),
			rows: {
				expenses: rowsIn(db, pass, "expenses"),
				shares,
				hiddenProjectIds: s.hiddenProjectIds,
				shareRateFor: shareRate,
			},
		};
	});
}

type View = Awaited<ReturnType<typeof viewOf>>;

export function insightsFigures(clock: () => Date): DeviceFigure[] {
	const view = (db: Reader, userId: string, pass?: FigurePass) =>
		viewOf(db, userId, clock, pass);

	const spanRead = (userId: string, v: View, span: Span, pass?: FigurePass) =>
		once(pass, `insights:span:${userId}:${span.from}`, async () =>
			spanReadFromRows(v.rows, v.ctx, span),
		);

	const spanFigure = (id: string, pick: (v: View) => Span): DeviceFigure => ({
		id,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await view(db, scope.userId, pass);
			return spanReading(await spanRead(scope.userId, v, pick(v), pass));
		},
	});

	const byCategory: DeviceFigure = {
		id: ID.byCategory,
		scope: ["categoryId"],
		compute: async (db, scope, pass) => {
			if (!scope.categoryId) return null;
			const v = await view(db, scope.userId, pass);
			const read = await spanRead(scope.userId, v, v.period, pass);
			return categoryReading(read, scope.categoryId, v.ctx.home);
		},
	};

	const byMonth: DeviceFigure = {
		id: ID.byMonth,
		scope: ["month"],
		compute: async (db, scope, pass) => {
			const { ctx, rows } = await view(db, scope.userId, pass);
			const month = scope.month ?? fiscalMonthLabel(ctx, ctx.now);
			const { bars, missing } = monthsFromRows(rows, ctx, [month]);
			return monthReading(bars, missing);
		},
	};

	const cashflowFigure = (
		id: string,
		pick: keyof typeof cashflowPicks,
	): DeviceFigure => ({
		id,
		scope: [],
		compute: async (db, scope, pass) => {
			const { ctx, rows, period } = await view(db, scope.userId, pass);
			const read = await once(
				pass,
				`insights:cashflow:${scope.userId}`,
				async () => cashflowFromRows(rows, ctx, period),
			);
			return cashflowReading(cashflowPicks[pick], read, ctx, period);
		},
	});

	const ytdFigure = (
		id: string,
		side: "thisYear" | "lastYear",
		currency: "home" | "usd",
		byCategory = false,
	): DeviceFigure => ({
		id,
		scope: byCategory ? ["categoryId"] : [],
		compute: async (db, scope, pass) => {
			if (byCategory && !scope.categoryId) return null;
			const { ctx, rows } = await view(db, scope.userId, pass);
			const read = await once(
				pass,
				`insights:ytd:${scope.userId}:${side}`,
				async () => ytdSideFromRows(rows, ctx, insightsYtdSpans(ctx)[side]),
			);
			return ytdReading(
				read,
				currency,
				ctx,
				byCategory ? scope.categoryId : undefined,
			);
		},
	});

	return [
		spanFigure(ID.spent, (v) => v.period),
		spanFigure(ID.spentPrevious, (v) => previousPeriod(v.ctx, v.period)),
		byCategory,
		byMonth,
		cashflowFigure(ID.income, "income"),
		cashflowFigure(ID.saved, "saved"),
		cashflowFigure(ID.dailyAverage, "dailyAverage"),
		cashflowFigure(ID.monthlyAverage, "monthlyAverage"),
		ytdFigure(ID.ytd, "thisYear", "home"),
		ytdFigure(ID.ytdLastYear, "lastYear", "home"),
		ytdFigure(ID.ytdByCategory, "thisYear", "home", true),
		ytdFigure(ID.ytdUsd, "thisYear", "usd"),
		ytdFigure(ID.ytdLastYearUsd, "lastYear", "usd"),
		ytdFigure(ID.ytdByCategoryUsd, "thisYear", "usd", true),
	];
}
