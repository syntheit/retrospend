/**
 * An envelope row's stored target as the engine's EnvelopeTarget, in the
 * book currency H. A target in another currency (D25) is converted at
 * today's rate and recomputed on every read; "about USD 990 today" is the
 * client's label for the converted amount. A bill that follows a recurring
 * expense takes the template's amount and next due date (D26).
 */

import type { Money } from "~/lib/schemas/envelope";
import type { Prisma, RecurringTemplate } from "~prisma";
import { budgetMonthOf, isoDateIn, type MonthBoundary } from "./months";
import type { EnvelopeTarget } from "./needs";
import type { IsoDate, Minor, MissingRate, MonthKey } from "./types";
import { toMinor } from "./units";
import { convertToBook, type ValuationContext } from "./valuation";

type Frequency = RecurringTemplate["frequency"];

/** Months between dues; bills repeat in whole months (WEEKLY and BIWEEKLY cannot be a bill target). */
export const REPEAT_MONTHS: Partial<Record<Frequency, number>> = {
	MONTHLY: 1,
	QUARTERLY: 3,
	YEARLY: 12,
};

export interface StoredTarget {
	kind: "MONTHLY" | "BILL" | "SAVINGS" | "NONE";
	targetAmount: Prisma.Decimal | null;
	targetMode: "REFILL" | "SET_ASIDE";
	targetCadence: "MONTH" | "WEEK";
	targetMonthlyAmount: Prisma.Decimal | null;
	targetCurrency: string | null;
	targetDueDate: Date | null;
	targetRepeat: Frequency | null;
	targetTemplateId: string | null;
}

export interface TargetContext {
	valuation: ValuationContext;
	today: IsoDate;
	month: MonthKey;
	tz: string;
	periods: readonly MonthBoundary[];
	templates: ReadonlyMap<string, RecurringTemplate>;
	missingRates: MissingRate[];
}

export interface TargetOf {
	target: EnvelopeTarget | null;
	foreign: Money | null;
	targetIncomplete: boolean;
}

/** A @db.Date column comes back as UTC midnight of that day. */
const dateOnly = (d: Date): IsoDate => d.toISOString().slice(0, 10);

function converter(ctx: TargetContext, currency: string) {
	const H = ctx.valuation.bookCurrency;
	let incomplete = false;
	const toH = (amount: Prisma.Decimal | null): Minor | null => {
		if (amount == null) return null;
		if (currency === H) return toMinor(amount.toString(), H);
		const v = convertToBook(
			amount.toString(),
			currency,
			{ date: ctx.today, month: ctx.month, foreignRateType: "official" },
			ctx.valuation,
		);
		if (v.ok) return v.minor;
		incomplete = true;
		ctx.missingRates.push(v.missing);
		return null;
	};
	return { toH, incomplete: () => incomplete };
}

function billFromTemplate(t: RecurringTemplate, ctx: TargetContext): TargetOf {
	const repeat = REPEAT_MONTHS[t.frequency];
	if (repeat === undefined)
		return { target: null, foreign: null, targetIncomplete: false };
	const c = converter(ctx, t.currency);
	const amount = c.toH(t.amount);
	const foreign =
		t.currency === ctx.valuation.bookCurrency
			? null
			: {
					minor: toMinor(t.amount.toString(), t.currency),
					currency: t.currency,
				};
	if (amount == null)
		return { target: null, foreign, targetIncomplete: c.incomplete() };
	return {
		target: {
			kind: "BILL",
			amount,
			dueDate: isoDateIn(t.nextDueDate, ctx.tz),
			repeatMonths: repeat,
			linkedToTemplate: true,
		},
		foreign,
		targetIncomplete: false,
	};
}

export function targetOf(e: StoredTarget, ctx: TargetContext): TargetOf {
	const none: TargetOf = {
		target: null,
		foreign: null,
		targetIncomplete: false,
	};
	if (e.kind === "NONE") return none;
	if (e.kind === "BILL" && e.targetTemplateId) {
		const t = ctx.templates.get(e.targetTemplateId);
		return t ? billFromTemplate(t, ctx) : none;
	}
	const currency = e.targetCurrency ?? ctx.valuation.bookCurrency;
	const c = converter(ctx, currency);
	const amount = c.toH(e.targetAmount);
	const monthly = c.toH(e.targetMonthlyAmount);
	const foreign =
		currency !== ctx.valuation.bookCurrency && e.targetAmount
			? { minor: toMinor(e.targetAmount.toString(), currency), currency }
			: null;
	if (c.incomplete()) return { target: null, foreign, targetIncomplete: true };
	if (e.kind === "MONTHLY") {
		return amount == null
			? none
			: {
					target: {
						kind: "MONTHLY",
						amount,
						mode: e.targetMode,
						cadence: e.targetCadence,
					},
					foreign,
					targetIncomplete: false,
				};
	}
	if (e.kind === "BILL") {
		if (amount == null || !e.targetDueDate) return none;
		const repeat = e.targetRepeat
			? (REPEAT_MONTHS[e.targetRepeat] ?? null)
			: null;
		return {
			target: {
				kind: "BILL",
				amount,
				dueDate: dateOnly(e.targetDueDate),
				repeatMonths: repeat,
				linkedToTemplate: false,
			},
			foreign,
			targetIncomplete: false,
		};
	}
	const dueMonth = e.targetDueDate
		? budgetMonthOf(dateOnly(e.targetDueDate), ctx.periods)
		: null;
	if (amount == null && monthly == null)
		return { target: null, foreign: null, targetIncomplete: false };
	return {
		target: { kind: "SAVINGS", amount, dueMonth, monthly },
		foreign,
		targetIncomplete: false,
	};
}
