/**
 * The Recurring tab read (recurring.listView): every template with its due
 * state, Money amounts, the next date after a confirm, the summary line
 * ("cost ARS X a month", per period) and this month's logged entries. The
 * server computes every number (R9); a template whose currency has no rate
 * is named in the summary and left out of it, never counted as zero (B16).
 */
import { isValidRate, USD } from "@retrospend/domain/money";
import type { Money } from "@retrospend/domain/money-minor";
import { nextRecurringDate } from "@retrospend/domain/recurring";
import {
	dayKey,
	fromWallTime,
	normalizeTimeZone,
	wallTime,
} from "@retrospend/domain/time-zone";
import { userTransaction } from "~/server/db-tx";
import { findExchangeRatesForDates } from "~/server/exchange-rates";
import type { Prisma, PrismaClient, RecurringTemplate } from "~prisma";
import { NO_CATEGORY_TONE } from "./expense-list/category-tone";
import {
	categoryRef,
	decimalMoney,
	type HomeRates,
	homeMajor,
	numberMoney,
} from "./expense-list/money";
import { shapeRows } from "./expense-list/rows";
import type { ActivityRowDTO, CategoryRefDTO } from "./expense-list/types";

type Db = PrismaClient | Prisma.TransactionClient;

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

export type RecurringView = {
	today: string;
	homeCurrency: string;
	items: RecurringItemDTO[];
	out: RecurringCost;
	/** Null when no active template brings money in. */
	in: RecurringCost | null;
	/**
	 * This month's entries logged from a template, by auto-pay or a Confirm:
	 * rows do not record which, so the section says "Logged this month".
	 */
	logged: ActivityRowDTO[];
};

/** How many times a frequency happens in an average month. */
const PER_MONTH: Record<RecurringTemplate["frequency"], number> = {
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

async function loggedThisMonth(
	tx: Prisma.TransactionClient,
	userId: string,
	rates: HomeRates,
	timeZone: string | undefined,
	now: Date,
): Promise<ActivityRowDTO[]> {
	const { year, month } = wallTime(now, timeZone);
	const rows = await tx.expense.findMany({
		where: {
			userId,
			recurringTemplateId: { not: null },
			date: { gte: fromWallTime({ year, month, day: 1 }, timeZone), lte: now },
		},
		orderBy: [{ date: "desc" }, { id: "desc" }],
		select: { id: true, date: true },
		take: 20,
	});
	return shapeRows(
		tx,
		rows.map((r) => ({ src: "p" as const, id: r.id, date: r.date })),
		{ userId, timeZone, rates },
	);
}

export async function listRecurringView(
	db: Db,
	userId: string,
	requestZone?: string,
	now: Date = new Date(),
): Promise<RecurringView> {
	const timeZone = normalizeTimeZone(requestZone);
	const today = dayKey(now, timeZone);
	return userTransaction(db as PrismaClient, userId, async (tx) => {
		const [user, templates] = await Promise.all([
			tx.user.findUnique({
				where: { id: userId },
				select: { homeCurrency: true },
			}),
			tx.recurringTemplate.findMany({
				where: { userId },
				orderBy: [{ nextDueDate: "asc" }, { id: "asc" }],
				include: {
					category: {
						select: { id: true, name: true, color: true, icon: true },
					},
				},
			}),
		]);
		const home = user?.homeCurrency ?? USD;
		const lookup = await findExchangeRatesForDates(tx, [
			home,
			...templates.map((t) => t.currency),
		]);
		const rates: HomeRates = {
			home,
			homeRate: lookup(home, now)?.rate ?? null,
		};
		const costs: Record<"out" | "in", CostLine[]> = { out: [], in: [] };
		const items = templates.map((t): RecurringItemDTO => {
			const amount = decimalMoney(t.amount, t.currency);
			const rate = lookup(t.currency, now)?.rate ?? null;
			const major = homeMajor(Number(t.amount), t.currency, rate, rates);
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
				nextAfter: dayKey(
					nextRecurringDate(t.nextDueDate, t.frequency, t.anchorDay),
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
			logged: await loggedThisMonth(tx, userId, rates, timeZone, now),
		};
	});
}
