/**
 * The pure half of the Recurring tab and its figures (recurring.amount,
 * recurring.cost.*): every template with its due state, Money amounts, the
 * next date after a confirm and the cost per period, from the templates and
 * the rates a loader hands in. The server loads them with SQL
 * (server/services/recurring-view.service.ts); a device loads its own rows
 * (recurringInputsFromRows). Both feed recurringBodyFrom, and a pg test holds
 * the two loaders to each other digit for digit.
 *
 * A template whose currency has no rate is named in the cost and left out of
 * it, never counted as zero or priced at 1. Due dates step in the user's saved
 * zone (`stepZone`) and days are shown in `timeZone`, which is the same unless
 * a request names another; income steps in UTC days (recurring.ts).
 */
import { NO_CATEGORY_TONE } from "./category-tone";
import { isValidRate, pickBestRate, type RateRow, USD } from "./money";
import type { Money } from "./money-minor";
import type { DecimalInput } from "./precise-decimal";
import {
	nextDueAfter,
	previousDueDay,
	type RecurringFrequency,
} from "./recurring";
import {
	type CategoryRefDTO,
	categoryRef,
	decimalMoney,
	type HomeRates,
	homeMajor,
	numberMoney,
	numberOf,
} from "./row-money";
import { dayKey } from "./time-zone";

export type RecurringFrequencyDTO =
	| "weekly"
	| "biweekly"
	| "monthly"
	| "quarterly"
	| "yearly";

export type RecurringItemDTO = {
	id: string;
	title: string;
	category: CategoryRefDTO;
	frequency: RecurringFrequencyDTO;
	/** ISO date of the next occurrence, in the viewer's zone. */
	next: string;
	/** The stored due instant, which a confirm sends back as its guard. */
	dueAt: string;
	/** The next date once this one is confirmed (the confirm step shows it). */
	nextAfter: string;
	/** The earliest day a confirm can say it was paid: the previous due day. */
	paidOnFrom: string;
	state: "upcoming" | "due" | "overdue";
	paused: boolean;
	autoPay: boolean;
	direction: "out" | "in";
	/** "ask": the amount varies, so a confirm needs the amount (the Confirm sheet, 2E). */
	amountMode: "fixed" | "ask";
	amount: Money;
	/** In the home currency when foreign; null: no rate yet. Absent: same currency. */
	home?: Money | null;
};

/** One direction's cost per period, at today's rates. */
export type RecurringCost = {
	month: Money;
	quarter: Money;
	year: Money;
	/**
	 * Currencies with no rate that leave active templates out of the cost:
	 * the template's own, or the home currency when its rate is missing.
	 */
	missingRate: string[];
};

/** The templates and costs: what the recurring figures read. */
export type RecurringBody = {
	today: string;
	homeCurrency: string;
	items: RecurringItemDTO[];
	out: RecurringCost;
	/** Null when no active template brings money in. */
	in: RecurringCost | null;
};

/** A template as stored, with its category, the fields the view reads. */
export interface RecurringTemplateRow {
	id: string;
	name: string;
	amount: DecimalInput;
	currency: string;
	frequency: RecurringFrequency;
	nextDueDate: Date;
	anchorDay: number | null;
	direction: "OUT" | "IN";
	isActive: boolean;
	autoPay: boolean;
	/** "ASK": the amount varies; anything else is fixed. */
	amountMode: string;
	category: {
		id: string;
		name: string;
		color: string;
		icon: string | null;
	} | null;
}

/** What a loader hands the compute: the home currency, the templates in page order, and each currency's rate today. */
export interface RecurringInputs {
	home: string;
	/** In the order the page lists them: next due date, then id. */
	templates: RecurringTemplateRow[];
	/** Units per USD on the day read, for the home currency and each template's (USD is 1 and needs no entry); null: no rate at all. */
	rates: Record<string, number | null>;
}

/** How many times a frequency happens in an average month. */
const PER_MONTH: Record<RecurringFrequency, number> = {
	WEEKLY: 52 / 12,
	BIWEEKLY: 26 / 12,
	MONTHLY: 1,
	QUARTERLY: 1 / 3,
	YEARLY: 1 / 12,
};

function stateOf(next: string, today: string): RecurringItemDTO["state"] {
	if (next < today) return "overdue";
	return next === today ? "due" : "upcoming";
}

type CostLine = { perMonth: number | null; missing: string[] };

function costOf(list: CostLine[], home: string): RecurringCost {
	let month = 0;
	const missing = new Set<string>();
	for (const x of list) {
		if (x.perMonth === null) for (const c of x.missing) missing.add(c);
		else month += x.perMonth;
	}
	return {
		month: numberMoney(month, home),
		quarter: numberMoney(month * 3, home),
		year: numberMoney(month * 12, home),
		missingRate: [...missing].sort(),
	};
}

/** The currencies whose missing rate keeps an amount out of the home total. */
function missingRates(
	currency: string,
	rate: number | null,
	rates: HomeRates,
): string[] {
	if (currency === rates.home) return [];
	const out: string[] = [];
	if (currency !== USD && !isValidRate(rate)) out.push(currency);
	if (rates.home !== USD && !isValidRate(rates.homeRate)) out.push(rates.home);
	return out;
}

/** The currencies a loader prices: the home currency and each template's, USD aside. */
export function recurringRateCurrencies(
	home: string,
	templates: readonly { currency: string }[],
): string[] {
	return [...new Set([home, ...templates.map((t) => t.currency)])].filter(
		(c) => c !== USD,
	);
}

/**
 * The templates in the order the page lists them: next due date, then id. The
 * server asks the database for this order; a device sorts its rows into it.
 */
export function sortRecurringTemplates<T extends RecurringTemplateRow>(
	templates: readonly T[],
): T[] {
	return [...templates].sort(
		(a, b) =>
			a.nextDueDate.getTime() - b.nextDueDate.getTime() ||
			(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
}

/**
 * The inputs from rows held in memory: what a device loader returns. The
 * rates are picked from all of a currency's rows, as the server's batch lookup
 * picks them.
 */
export function recurringInputsFromRows(args: {
	home: string;
	templates: readonly RecurringTemplateRow[];
	/** Every rate row of the home currency and the templates' currencies, any date and type. */
	rateRows: Readonly<Record<string, readonly RateRow[]>>;
	now: Date;
}): RecurringInputs {
	const templates = sortRecurringTemplates(args.templates);
	const rates: Record<string, number | null> = {};
	for (const c of recurringRateCurrencies(args.home, templates))
		rates[c] =
			pickBestRate(args.rateRows[c] ?? [], { date: args.now })?.rate ?? null;
	return { home: args.home, templates, rates };
}

/**
 * The templates and costs at `now`. `timeZone` is the zone days are shown in,
 * `stepZone` the user's saved zone due dates step in.
 */
export function recurringBodyFrom(args: {
	inputs: RecurringInputs;
	now: Date;
	timeZone: string;
	stepZone: string;
}): RecurringBody & { rates: HomeRates } {
	const { inputs, now, timeZone, stepZone } = args;
	const home = inputs.home;
	const rateOf = (currency: string) =>
		currency === USD ? 1 : (inputs.rates[currency] ?? null);
	const rates: HomeRates = { home, homeRate: rateOf(home) };
	const today = dayKey(now, timeZone);
	const costs: Record<"out" | "in", CostLine[]> = { out: [], in: [] };
	const items = inputs.templates.map((t): RecurringItemDTO => {
		const amount = decimalMoney(t.amount, t.currency);
		const rate = rateOf(t.currency);
		const major = homeMajor(numberOf(t.amount), t.currency, rate, rates);
		const homeValue = major === null ? null : numberMoney(major, home);
		const direction = t.direction === "IN" ? "in" : "out";
		const next = dayKey(t.nextDueDate, timeZone);
		if (t.isActive)
			costs[direction].push({
				missing: missingRates(t.currency, rate, rates),
				perMonth: major === null ? null : major * PER_MONTH[t.frequency],
			});
		return {
			id: t.id,
			title: t.name,
			category: categoryRef(t.category) ?? {
				id: null,
				name: null,
				icon: null,
				tone: NO_CATEGORY_TONE,
			},
			frequency: t.frequency.toLowerCase() as RecurringFrequencyDTO,
			next,
			dueAt: t.nextDueDate.toISOString(),
			nextAfter: dayKey(nextDueAfter(t, t.nextDueDate, stepZone), timeZone),
			paidOnFrom: previousDueDay(
				t,
				t.direction === "IN" ? "IN" : "OUT",
				timeZone,
			),
			state: stateOf(next, today),
			paused: !t.isActive,
			autoPay: t.autoPay,
			direction,
			amountMode: t.amountMode === "ASK" ? "ask" : "fixed",
			amount,
			...(t.currency === home ? {} : { home: homeValue }),
		};
	});
	return {
		today,
		homeCurrency: home,
		items,
		out: costOf(costs.out, home),
		in: costs.in.length ? costOf(costs.in, home) : null,
		rates,
	};
}

export type RecurringDirection = "out" | "in";
export type RecurringPeriod = "month" | "quarter" | "year";

/** recurring.amount: one template's amount in its own currency; none when it is not there. */
export function recurringAmountOf(body: RecurringBody, id: string): Money[] {
	const item = body.items.find((i) => i.id === id);
	return item ? [item.amount] : [];
}

/**
 * recurring.cost.<direction>.<period>: what the active templates of one
 * direction cost (or bring in) per period in the home currency. A template in
 * a currency with no rate makes it unavailable, naming them: never the sum of
 * the rest, zero or a rate of 1. An "in" figure is empty when no active
 * template brings money in.
 */
export function recurringCostOf(
	body: RecurringBody,
	direction: RecurringDirection,
	period: RecurringPeriod,
): Money[] | { unavailable: string[] } {
	const cost = body[direction];
	if (!cost) return [];
	if (cost.missingRate.length > 0) return { unavailable: cost.missingRate };
	return [cost[period]];
}
