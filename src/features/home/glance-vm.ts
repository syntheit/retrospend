/**
 * home.glance to the kit's GlanceVM. Nothing is computed here (R9): every
 * amount is one the server sent, and the line is picked by comparing the
 * server's figures, never by subtracting them.
 */
import type {
	GlanceLine,
	GlanceRow,
	GlanceVM,
} from "~/components/glance/glance-strip";
import type { FacePerson } from "~/components/ui/avatar-face";
import type { GlanceDTO } from "~/server/services/figures/glance";

/** Where each glance row leads. */
export const GLANCE_HREF = {
	toAssign: "/budget",
	owedToYou: "/people",
	youOwe: "/people",
	netWorth: "/wealth",
	moneyIn: "/activity?kind=in",
	dollarToday: "/currencies",
} as const;

/**
 * The line under the hero: the budget's state, or without a budget the pace
 * in words against last month by the same day (the server's verdict), or
 * "No budget" while there is no pace yet. Currencies a Needs you item
 * already names are not named again (a fact appears once).
 */
export function lineOf(
	dto: GlanceDTO,
	namedElsewhere: readonly string[] = [],
): GlanceLine {
	const budget = dto.budget;
	if (!budget)
		return dto.pace.fasterThanLast === null
			? { kind: "noBudget" }
			: {
					kind: "pace",
					faster: dto.pace.fasterThanLast,
					lastMonth: dto.lastPeriod.from,
				};
	if (budget.state === "incomplete")
		return {
			kind: "unavailable",
			currencies: budget.missingRates.filter(
				(c) => !namedElsewhere.includes(c),
			),
		};
	const left = budget.leftToSpend;
	// A Limits book has no spending pool: its line reads the limits (the
	// verdict), not Left to spend, which would add the hidden To assign.
	if (budget.verdict.style === "LIMITS") {
		const v = budget.verdict;
		if (v.over.minor > 0) return { kind: "over", over: v.over };
		if (v.daysLeft <= 1) return { kind: "leftToday", left: v.lead.amount };
		return { kind: "perDay", perDay: v.perDay, daysLeft: v.daysLeft };
	}
	if (left.over.minor > 0) return { kind: "over", over: left.over };
	if (left.daysLeft <= 1) return { kind: "leftToday", left: left.left };
	return { kind: "perDay", perDay: left.perDay, daysLeft: left.daysLeft };
}

type Figure = GlanceDTO["owedToYou"];

/**
 * A row when its figure has something to say: a value that is not zero, or
 * no value at all (a missing rate), which the row says rather than hiding
 * the number (R14).
 */
function row(
	id: GlanceRow["id"],
	figure: Figure,
	faces?: FacePerson[],
): GlanceRow[] {
	const value = figure.value;
	if (value && value.minor === 0) return [];
	return [
		{
			id,
			amount: value,
			href: GLANCE_HREF[id],
			figure: figure.id,
			...(faces?.length ? { faces } : {}),
		},
	];
}

/** The faces behind the owed rows (rule 8), from People's read. */
export type OwedFaces = {
	owedToYou: FacePerson[];
	youOwe: FacePerson[];
};

/** A series with nothing spent yet: the chart says "no data", never a flat zero. */
const series = (values: readonly number[] | null) =>
	values?.some((v) => v !== 0) ? [...values] : [];

/** The row's rate name in the viewer's words, with the day when the rate is older than today. */
export type DollarLabel = (
	rateType: string,
	rateDate: string,
	today: string,
) => string;

/**
 * Dollar today: the price of USD 1 at the person's default rate type. The
 * row is left out for a USD or crypto home (the server sends none) and while
 * home has no rate at all (R14: the glance never shows a guess).
 */
function dollarRow(dto: GlanceDTO, label?: DollarLabel): GlanceRow[] {
	const d = dto.dollarToday;
	if (!d?.value || !d.rateType || !d.rateDate) return [];
	return [
		{
			id: "dollarToday",
			amount: d.value,
			href: GLANCE_HREF.dollarToday,
			figure: d.id,
			code: true,
			rateLabel: label ? label(d.rateType, d.rateDate, dto.today) : d.rateType,
		},
	];
}

export function toGlanceVM(
	dto: GlanceDTO,
	options: {
		named?: readonly string[];
		faces?: OwedFaces;
		dollarLabel?: DollarLabel;
	} = {},
): GlanceVM {
	const budget = dto.budget?.state === "ready" ? dto.budget : null;
	const current = series(dto.pace.this);
	const previous = series(dto.pace.last);
	const empty = !current.length && !previous.length;
	return {
		month: dto.period.from,
		spent: dto.spent.value,
		spentFigure: dto.spent.id,
		line: lineOf(dto, options.named),
		fasterThanPlanned: budget?.leftToSpend.fasterThanPlanned ?? false,
		pace: {
			currency: dto.home,
			// Last month alone still draws (this month at zero so far).
			current: empty ? [] : [...(dto.pace.this ?? [])],
			previous,
			days: dto.period.days,
		},
		rows: [
			...(budget ? row("toAssign", budget.notPlannedYet) : []),
			// Two rows, never netted (D1).
			...row("owedToYou", dto.owedToYou, options.faces?.owedToYou),
			...row("youOwe", dto.youOwe, options.faces?.youOwe),
			...row("netWorth", dto.netWorth),
			// Just track: money in beside spent (only sent without a budget part).
			...(dto.moneyIn ? row("moneyIn", dto.moneyIn) : []),
			...dollarRow(dto, options.dollarLabel),
		],
	};
}

/**
 * Currencies the page still has to name: the glance line names them when
 * the budget is unavailable, and a Needs you item when it asks for a rate,
 * so a fact appears once.
 */
export function unnamedMissingRates(
	dto: GlanceDTO,
	namedElsewhere: readonly string[],
): string[] {
	const named = new Set(namedElsewhere);
	if (dto.budget?.state === "incomplete")
		for (const c of dto.budget.missingRates) named.add(c);
	return dto.missingRates.filter((c) => !named.has(c));
}
