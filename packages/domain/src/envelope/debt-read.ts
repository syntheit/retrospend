/**
 * The payoff projection (SPEC §5.11, D3, D72) from a source: the saved plan
 * or the overrides the slider tries, over today's balances. A debt in
 * another currency is projected in its own currency; one with no rate today
 * to the book currency is left out and listed (R14), never valued at 1.
 *
 * Pure: the server reads the book, the plan, the liabilities and the rates
 * through its transaction (server/services/envelope/debt.service.ts), a
 * device from its own store. Never writes.
 */
import { type Decimal, dec } from "../precise-decimal";
import { addDays } from "./calendar";
import type { PayoffPlanDto, PayoffProjection } from "./dto";
import { budgetMonthOf, isoDateIn } from "./months";
import { type PayoffDebt, projectPayoff } from "./payoff";
import { RateBook, type RateBookParams, type RateRow } from "./rate-book";
import type { MonthKey } from "./types";
import { fromMinor, toMinor } from "./units";
import {
	convertToBook,
	rateTypeForMonth,
	type ValuationContext,
} from "./valuation";

/** The book a projection values in: its currency, zone and rate types per period. */
export interface DebtBook {
	currency: string;
	timeZone: string;
	periods: ReadonlyArray<{
		fromMonth: MonthKey;
		startDay: number;
		rateType: string;
	}>;
}

/** An open liability as the projection reads it. */
export interface LiabilityRow {
	id: string;
	currency: string;
	balance: Decimal;
	interestRate: Decimal | null;
	minimumPayment: Decimal | null;
	dueDate: number | null;
}

/** What the projection reads. */
export interface DebtSource {
	/** The personal book; throws NO_BOOK without one. */
	book(): Promise<DebtBook>;
	/** The book's plan; with none yet, Avalanche with no extra (the default). */
	savedPlan(): Promise<PayoffPlanDto>;
	/** The user's open liabilities, oldest first. */
	liabilities(): Promise<LiabilityRow[]>;
	rateRows(p: RateBookParams): Promise<RateRow[]>;
}

/** Another plan to try without saving it (the slider); default: the saved plan. */
export interface PayoffRequest {
	strategy?: PayoffPlanDto["strategy"];
	extraMonthlyMinor?: number;
	customOrder?: readonly string[];
}

/** Book currency per 1 unit of `currency` today, from a million units (display only). */
function bookPerUnit(currency: string, ctx: ValuationContext, today: string) {
	if (currency === ctx.bookCurrency) return dec(1);
	const v = convertToBook(
		"1000000",
		currency,
		{
			date: today,
			month: budgetMonthOf(today, ctx.periods),
			// The book's rate type for this month (BookPeriod), as targets use.
			foreignRateType: rateTypeForMonth(budgetMonthOf(today, ctx.periods), ctx),
		},
		ctx,
	);
	if (!v.ok) return null;
	return fromMinor(v.minor, ctx.bookCurrency).div(1_000_000);
}

async function valuationFor(
	src: DebtSource,
	book: DebtBook,
	currencies: readonly string[],
	today: string,
): Promise<ValuationContext> {
	const p: RateBookParams = {
		bookCurrency: book.currency,
		rateTypes: [
			...new Set(["official", ...book.periods.map((p) => p.rateType)]),
		],
		since: addDays(today, -31),
		extraCurrencies: currencies,
	};
	const rates = RateBook.fromRows(await src.rateRows(p), p);
	return {
		bookCurrency: book.currency,
		periods: book.periods.map((p) => ({
			fromMonth: p.fromMonth,
			startDay: p.startDay,
			rateType: p.rateType,
		})),
		defaultRateType: book.periods[0]?.rateType ?? "official",
		usdRate: rates.lookup,
	};
}

/** The projection for the saved plan, or for the overrides the slider tries. Never writes. */
export async function payoffFrom(
	src: DebtSource,
	input: PayoffRequest,
	now: Date,
): Promise<PayoffProjection> {
	const book = await src.book();
	const H = book.currency;
	const saved = await src.savedPlan();
	const plan: PayoffPlanDto = {
		...saved,
		strategy: input.strategy ?? saved.strategy,
		extraMonthly:
			input.extraMonthlyMinor === undefined
				? saved.extraMonthly
				: { minor: input.extraMonthlyMinor, currency: H },
		customOrder: input.customOrder ? [...input.customOrder] : saved.customOrder,
	};
	const today = isoDateIn(now, book.timeZone);
	const all = (await src.liabilities()).filter((a) => dec(a.balance).gt(0));
	const ctx = await valuationFor(
		src,
		book,
		[...new Set(all.map((a) => a.currency))],
		today,
	);
	const missing: PayoffProjection["missingRates"] = [];
	const debts: Array<PayoffDebt & { dueDay: number | null }> = [];
	for (const a of all) {
		const rate = bookPerUnit(a.currency, ctx, today);
		if (!rate) {
			missing.push({ assetAccountId: a.id, currency: a.currency });
			continue;
		}
		debts.push({
			id: a.id,
			currency: a.currency,
			balance: toMinor(a.balance, a.currency),
			aprPercent: a.interestRate ? dec(a.interestRate).toString() : "0",
			minimum: a.minimumPayment ? toMinor(a.minimumPayment, a.currency) : 0,
			bookPerUnit: rate,
			dueDay: a.dueDate,
		});
	}
	const r = projectPayoff({
		bookCurrency: H,
		debts,
		strategy: plan.strategy,
		customOrder: plan.customOrder,
		extraMonthly: plan.extraMonthly.minor,
		startMonth: budgetMonthOf(today, ctx.periods),
	});
	const own = (minor: number, currency: string) => ({ minor, currency });
	const total = debts.reduce(
		(t, d) =>
			t + toMinor(fromMinor(d.balance, d.currency).mul(dec(d.bookPerUnit)), H),
		0,
	);
	return {
		plan,
		debtFreeMonth: r.debtFreeMonth,
		months: r.months,
		capped: r.capped,
		diverges: r.diverges,
		totalDebt: own(total, H),
		totalInterest: own(r.totalInterest, H),
		debts: debts.map((d, i) => {
			const o = r.debts[i] as (typeof r.debts)[number];
			return {
				assetAccountId: d.id,
				balance: own(d.balance, d.currency),
				aprPercent: dec(d.aprPercent).toString(),
				minimum: own(d.minimum, d.currency),
				dueDay: d.dueDay,
				payoffMonth: o.payoffMonth,
				interest: own(o.interest, d.currency),
				nextMinimum: own(o.nextMinimum, d.currency),
				nextExtra: own(o.nextExtra, d.currency),
			};
		}),
		schedule: r.schedule,
		missingRates: missing,
		incomplete: missing.length > 0,
	};
}
