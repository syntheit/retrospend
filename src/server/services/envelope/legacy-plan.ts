/**
 * Legacy budget to Limits (budget build plan 02 §6, SPEC §8.1). Pure: the
 * caller loads the source month's `budget` rows, the user's categories, the
 * spending the pegged budgets read and a converter for today's rates, and
 * gets back the setup the Limits book starts from plus what to add after it
 * and a report. Nothing here reads a database or a clock, so the script
 * (dry run included) and the lazy first read run the very same function.
 *
 * Money rules: integer minor units only; an amount in another currency is
 * converted only to size what is funded, through the caller's converter, and
 * a currency the converter has no rate for refuses the user (listed, never
 * valued at 1). A target keeps its own currency (D25).
 */
import type { SetupInput, TargetInput } from "~/lib/schemas/envelope";
import type { Minor } from "./types";
import { toMinor } from "./units";

/** The API default group names; user text, written as typed. */
const BILLS = "Bills";
const EVERYDAY = "Everyday";
const DEFAULT_NAME = "Everything else";

/** A schema limit: one envelope links up to this many categories. */
const MAX_LINKS = 200;

export interface LegacyBudgetRow {
	/** Null: the global budget. */
	categoryId: string | null;
	amount: string;
	currency: string;
	type: "FIXED" | "PEG_TO_ACTUAL" | "PEG_TO_LAST_MONTH";
	/** The older boolean that meant PEG_TO_ACTUAL. */
	pegToActual: boolean;
	isRollover: boolean;
	rolloverAmount: string;
}

export interface LegacyCategory {
	id: string;
	name: string;
	icon: string | null;
	color: string;
	isFixed: boolean;
}

export interface LegacyPlanInput {
	/** The book currency (the user's home currency). */
	currency: string;
	/** The source month's rows, in a stable order (the first global row wins). */
	budgets: readonly LegacyBudgetRow[];
	/** Every expense category of the user. */
	categories: readonly LegacyCategory[];
	/** `amount` of `currency` in book minor units at today's rates, null without a rate. */
	convert: (amount: string, currency: string) => Minor | null;
	/** Spending so far this month per category (null key: no category), book minor units. */
	spentNow: ReadonlyMap<string | null, Minor>;
	/** The same for the last month. */
	spentLast: ReadonlyMap<string | null, Minor>;
	/** Currencies of spending rows the loader could not value. */
	spendingMissing: readonly string[];
}

/** One envelope the book starts with, before it has an id. */
export interface PlannedEnvelope {
	key: string;
	name: string;
	categoryId: string | null;
	color: string | null;
	/** What this month's plan funding gives it, book minor units. */
	fundMinor: Minor;
	/** Added to the first plan funding from an old rollover. */
	rolloverMinor: Minor;
	/** A pegged budget: no target, this month's activity is assigned. */
	pegged: boolean;
	source:
		| "FIXED"
		| "PEG_TO_ACTUAL"
		| "PEG_TO_LAST_MONTH"
		| "GLOBAL"
		| "DEFAULT";
}

export interface LegacyPlanReport {
	/** Category budgets read, by kind. */
	fixed: number;
	pegToActual: number;
	pegToLastMonth: number;
	global: boolean;
	/** Legacy rows left out and why (a category that is gone or not an expense one). */
	left: { categoryId: string | null; reason: string }[];
	/** What the old budget totaled, book minor units (the old dashboard's rule). */
	beforeMinor: Minor;
	/** What the new plan funds this month, book minor units. */
	plannedMinor: Minor;
}

export interface LegacyPlan {
	setup: SetupInput;
	envelopes: PlannedEnvelope[];
	report: LegacyPlanReport;
}

export type LegacyPlanResult =
	| { ok: true; plan: LegacyPlan }
	| { ok: false; refusal: LegacyRefusal };

export type LegacyRefusal =
	| { reason: "NOTHING_TO_MIGRATE" }
	| { reason: "MISSING_RATE"; currencies: string[] };

const sum = (values: Iterable<Minor>) => {
	let total = 0;
	for (const v of values) total += v;
	return total;
};

function isPegActual(b: LegacyBudgetRow) {
	return b.type === "PEG_TO_ACTUAL" || b.pegToActual;
}

/** Spending in categories no envelope links, including rows with no category. */
function spentOutside(
	spent: ReadonlyMap<string | null, Minor>,
	linked: ReadonlySet<string>,
) {
	let total = 0;
	for (const [categoryId, minor] of spent) {
		if (categoryId === null || !linked.has(categoryId)) total += minor;
	}
	return total;
}

interface Source {
	row: LegacyBudgetRow;
	category: LegacyCategory;
}

/** Category budgets whose category is one of the user's expense categories, by category name. */
function categorySources(input: LegacyPlanInput, report: LegacyPlanReport) {
	const byId = new Map(input.categories.map((c) => [c.id, c]));
	const out: Source[] = [];
	const seen = new Set<string>();
	for (const row of input.budgets) {
		if (row.categoryId === null) continue;
		const category = byId.get(row.categoryId);
		if (!category) {
			report.left.push({
				categoryId: row.categoryId,
				reason: "not an expense category",
			});
			continue;
		}
		if (seen.has(category.id)) continue;
		seen.add(category.id);
		out.push({ row, category });
	}
	return out.sort(
		(a, b) =>
			(a.category.name < b.category.name ? -1 : 1) ||
			(a.category.id < b.category.id ? -1 : 1),
	);
}

/** The target of a category budget and what this month's funding is. */
function categoryEnvelope(
	s: Source,
	key: string,
	input: LegacyPlanInput,
	missing: Set<string>,
): { target?: TargetInput; planned: PlannedEnvelope; limit: Minor } {
	const H = input.currency;
	const { row, category } = s;
	const planned: PlannedEnvelope = {
		key,
		name: category.name,
		categoryId: category.id,
		color: category.color,
		fundMinor: 0,
		rolloverMinor: 0,
		pegged: false,
		source: row.type,
	};
	const money = (amount: string, currency: string) => {
		const minor = input.convert(amount, currency);
		if (minor === null) missing.add(currency);
		return minor ?? 0;
	};
	if (isPegActual(row)) {
		planned.source = "PEG_TO_ACTUAL";
		planned.pegged = true;
		planned.fundMinor = Math.max(0, input.spentNow.get(category.id) ?? 0);
		return { planned, limit: 0 };
	}
	if (row.type === "PEG_TO_LAST_MONTH") {
		const last = Math.max(0, input.spentLast.get(category.id) ?? 0);
		planned.fundMinor = last;
		return {
			planned,
			limit: last,
			target:
				last > 0
					? {
							kind: "MONTHLY",
							amountMinor: last,
							mode: "SET_ASIDE",
							cadence: "MONTH",
						}
					: undefined,
		};
	}
	const own = toMinor(row.amount, row.currency);
	const inBook = money(row.amount, row.currency);
	planned.fundMinor = inBook;
	if (row.isRollover && Number(row.rolloverAmount) > 0)
		planned.rolloverMinor = money(row.rolloverAmount, row.currency);
	return {
		planned,
		limit: inBook,
		target:
			own > 0
				? {
						kind: "MONTHLY",
						amountMinor: own,
						mode: "SET_ASIDE",
						cadence: "MONTH",
						...(row.currency === H ? {} : { currency: row.currency }),
					}
				: undefined,
	};
}

interface DefaultPlan {
	planned: PlannedEnvelope;
	target?: TargetInput;
}

/** "Everything else": the global budget minus the category limits, or no target. */
function defaultEnvelope(
	global: LegacyBudgetRow | undefined,
	limits: Minor,
	linked: ReadonlySet<string>,
	input: LegacyPlanInput,
	missing: Set<string>,
): DefaultPlan {
	const planned: PlannedEnvelope = {
		key: "else",
		name: DEFAULT_NAME,
		categoryId: null,
		color: null,
		fundMinor: 0,
		rolloverMinor: 0,
		pegged: false,
		source: global ? "GLOBAL" : "DEFAULT",
	};
	if (!global) return { planned };
	const set = (minor: Minor): DefaultPlan => {
		planned.fundMinor = minor;
		return {
			planned,
			target:
				minor > 0
					? {
							kind: "MONTHLY",
							amountMinor: minor,
							mode: "SET_ASIDE",
							cadence: "MONTH",
						}
					: undefined,
		};
	};
	if (isPegActual(global)) {
		planned.pegged = true;
		planned.fundMinor = Math.max(0, spentOutside(input.spentNow, linked));
		return { planned };
	}
	if (global.type === "PEG_TO_LAST_MONTH")
		return set(Math.max(0, spentOutside(input.spentLast, linked)));
	const inBook = input.convert(global.amount, global.currency);
	if (inBook === null) missing.add(global.currency);
	if (global.isRollover && Number(global.rolloverAmount) > 0) {
		const roll = input.convert(global.rolloverAmount, global.currency);
		if (roll === null) missing.add(global.currency);
		planned.rolloverMinor = roll ?? 0;
	}
	// The old budget could hold less than its categories; the envelope then has no limit of its own.
	return set(Math.max(0, (inBook ?? 0) - limits));
}

/**
 * What the old dashboard called the total budget (overview.service.ts), in
 * book minor units: a global limit plus the pegged categories' spending, else
 * the category budgets added up.
 */
function legacyTotal(
	global: LegacyBudgetRow | undefined,
	planned: readonly PlannedEnvelope[],
	input: LegacyPlanInput,
) {
	const ofCategories = planned.filter((p) => p.categoryId !== null);
	const globalLimit =
		global && !isPegActual(global) && global.type === "FIXED"
			? (input.convert(global.amount, global.currency) ?? 0)
			: 0;
	if (globalLimit > 0)
		return (
			globalLimit +
			sum(ofCategories.filter((p) => p.pegged).map((p) => p.fundMinor))
		);
	const rest = global
		? (planned.find((p) => p.key === "else")?.fundMinor ?? 0)
		: 0;
	return sum(ofCategories.map((p) => p.fundMinor)) + rest;
}

/**
 * The setup a legacy user's book starts from. Refuses, listing currencies,
 * when any amount that sizes the funding has no rate.
 */
export function planLegacyMigration(input: LegacyPlanInput): LegacyPlanResult {
	const report: LegacyPlanReport = {
		fixed: 0,
		pegToActual: 0,
		pegToLastMonth: 0,
		global: false,
		left: [],
		beforeMinor: 0,
		plannedMinor: 0,
	};
	const global = input.budgets.find((b) => b.categoryId === null);
	const sources = categorySources(input, report);
	const worth = (b: LegacyBudgetRow) =>
		isPegActual(b) || b.type === "PEG_TO_LAST_MONTH" || Number(b.amount) > 0;
	if (sources.length === 0 && !(global && worth(global)))
		return { ok: false, refusal: { reason: "NOTHING_TO_MIGRATE" } };

	const missing = new Set<string>(input.spendingMissing);
	const envelopes: SetupInput["envelopes"] = [];
	const planned: PlannedEnvelope[] = [];
	const links = new Set<string>();
	let limits = 0;
	sources.forEach((s, i) => {
		const key = `e${i + 1}`;
		const made = categoryEnvelope(s, key, input, missing);
		if (s.row.type === "FIXED" && !isPegActual(s.row)) report.fixed += 1;
		else if (isPegActual(s.row)) report.pegToActual += 1;
		else report.pegToLastMonth += 1;
		if (!made.planned.pegged) limits += made.limit;
		links.add(s.category.id);
		planned.push(made.planned);
		envelopes.push({
			key,
			name: s.category.name,
			groupKey: s.category.isFixed ? "bills" : "everyday",
			kind: made.planned.pegged ? "NONE" : "MONTHLY",
			isDefault: false,
			...(s.category.icon ? { icon: s.category.icon } : {}),
			categoryIds: [s.category.id],
			...(made.target ? { target: made.target } : {}),
		});
	});

	const rest = input.categories
		.filter((c) => !links.has(c.id))
		.map((c) => c.id)
		.slice(0, MAX_LINKS);
	const fallback = defaultEnvelope(global, limits, links, input, missing);
	report.global = global !== undefined;
	planned.push(fallback.planned);
	envelopes.push({
		key: "else",
		name: DEFAULT_NAME,
		groupKey: "everyday",
		kind: fallback.planned.pegged ? "NONE" : "MONTHLY",
		isDefault: true,
		categoryIds: rest,
		...(fallback.target ? { target: fallback.target } : {}),
	});

	if (missing.size > 0)
		return {
			ok: false,
			refusal: { reason: "MISSING_RATE", currencies: [...missing].sort() },
		};

	const hasBills = envelopes.some((e) => e.groupKey === "bills");
	report.beforeMinor = legacyTotal(global, planned, input);
	report.plannedMinor = sum(planned.map((p) => p.fundMinor + p.rolloverMinor));
	return {
		ok: true,
		plan: {
			setup: {
				style: "LIMITS",
				groups: [
					...(hasBills
						? [{ key: "bills", name: BILLS, role: "BILLS" as const }]
						: []),
					{ key: "everyday", name: EVERYDAY, role: "SPENDING" as const },
				],
				envelopes,
			},
			envelopes: planned,
			report,
		},
	};
}
