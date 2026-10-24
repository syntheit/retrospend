/**
 * Debts in the budget (SPEC §5.11, D3, D72): liability terms, the payoff
 * plan and its projection.
 *
 * - Terms: APR, minimum and due day live on the liability (asset_account);
 *   editing them moves no money.
 * - The plan: one per book, a projection input only. Saving it gives the
 *   "Extra debt payment" envelope a Set aside target equal to the extra.
 * - The projection starts from today's balances. A debt in another currency
 *   is projected in its own currency; one with no rate today to the book
 *   currency is left out and listed (R14), never valued at 1.
 *
 * Pay down a debt is in debt-payment.service.ts.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
	DebtTerms,
	DebtTermsResult,
	PayoffPlanDto,
	PayoffPlanResult,
	PayoffProjectInput,
	PayoffProjection,
	SavePayoffPlanInput,
	SetDebtTermsInput,
} from "~/lib/schemas/envelope-debt";
import { Prisma } from "~prisma";
import { LIABILITY_TYPES } from "./book.service";
import { addDays } from "./calendar";
import { EnvelopeError } from "./errors";
import { findPersonalBook } from "./inputs";
import { forgetMonthViews } from "./month-read";
import { budgetMonthOf, isoDateIn } from "./months";
import { type PayoffDebt, projectPayoff } from "./payoff";
import { RateBook } from "./rate-book";
import { dec, fromMinor, toMinor } from "./units";
import { convertToBook, type ValuationContext } from "./valuation";

type Tx = Prisma.TransactionClient;

function invalid(message: string): never {
	throw new EnvelopeError("INVALID", message);
}

type Liability = Awaited<ReturnType<typeof liabilitiesOf>>[number];

/** The user's open liabilities (RLS shows only theirs), oldest first. */
export function liabilitiesOf(tx: Tx, ids?: readonly string[]) {
	return tx.assetAccount.findMany({
		where: {
			type: { in: [...LIABILITY_TYPES] },
			closedAt: null,
			...(ids ? { id: { in: [...ids] } } : {}),
		},
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
}

function termsOf(a: Liability): DebtTerms {
	return {
		assetAccountId: a.id,
		aprPercent: a.interestRate ? dec(a.interestRate).toString() : null,
		minimum: a.minimumPayment
			? { minor: toMinor(a.minimumPayment, a.currency), currency: a.currency }
			: null,
		dueDay: a.dueDate,
	};
}

export async function setDebtTerms(
	tx: Tx,
	input: SetDebtTermsInput,
): Promise<DebtTermsResult> {
	const [a] = await liabilitiesOf(tx, [input.assetAccountId]);
	if (!a) throw new EnvelopeError("NOT_FOUND", "no such debt");
	const updated = await tx.assetAccount.update({
		where: { id: a.id },
		data: {
			interestRate:
				input.aprPercent === null ? null : new Prisma.Decimal(input.aprPercent),
			minimumPayment:
				input.minimumMinor === null
					? null
					: new Prisma.Decimal(
							fromMinor(input.minimumMinor, a.currency).toString(),
						),
			dueDate: input.dueDay,
		},
	});
	forgetMonthViews(tx);
	return { terms: termsOf(updated), previous: termsOf(a) };
}

async function requireBook(tx: Tx, userId: string) {
	const book = await findPersonalBook(tx, userId);
	if (!book?.defaultEnvelopeId)
		throw new EnvelopeError("NO_BOOK", "start a budget first");
	return book;
}

function planDto(
	p: {
		strategy: PayoffPlanDto["strategy"];
		extraMonthly: Prisma.Decimal;
		customOrder: unknown;
		envelopeId: string | null;
	},
	H: string,
): PayoffPlanDto {
	return {
		strategy: p.strategy,
		extraMonthly: { minor: toMinor(p.extraMonthly, H), currency: H },
		customOrder: z.array(z.string()).parse(p.customOrder),
		envelopeId: p.envelopeId,
	};
}

/** The book's plan; with none yet, Avalanche with no extra (the default). */
export async function getPayoffPlan(
	tx: Tx,
	userId: string,
): Promise<PayoffPlanDto> {
	const book = await requireBook(tx, userId);
	const p = await tx.payoffPlan.findUnique({ where: { bookId: book.id } });
	return p
		? planDto(p, book.currency)
		: {
				strategy: "AVALANCHE",
				extraMonthly: { minor: 0, currency: book.currency },
				customOrder: [],
				envelopeId: null,
			};
}

export async function savePayoffPlan(
	tx: Tx,
	userId: string,
	input: SavePayoffPlanInput,
): Promise<PayoffPlanResult> {
	const book = await requireBook(tx, userId);
	const H = book.currency;
	const env = input.envelopeId
		? book.envelopes.find(
				(e) => e.id === input.envelopeId && e.archivedAt === null,
			)
		: null;
	if (input.envelopeId && (!env || env.kind !== "MONTHLY"))
		invalid("the extra goes to a Monthly envelope of your budget");
	const known = new Set(
		(await liabilitiesOf(tx, input.customOrder)).map((a) => a.id),
	);
	if (input.customOrder.some((id) => !known.has(id)))
		invalid("your order names one of your debts");
	const before = await tx.payoffPlan.findUnique({ where: { bookId: book.id } });
	const data = {
		strategy: input.strategy,
		extraMonthly: new Prisma.Decimal(
			fromMinor(input.extraMonthlyMinor, H).toString(),
		),
		customOrder: input.customOrder,
		envelopeId: input.envelopeId,
	};
	const saved = await tx.payoffPlan.upsert({
		where: { bookId: book.id },
		create: { id: randomUUID(), bookId: book.id, ...data },
		update: data,
	});
	// "Extra debt payment" gets a Set aside target equal to the plan's extra (SPEC §5.11).
	if (env)
		await tx.envelope.update({
			where: { id: env.id },
			data: {
				targetAmount: data.extraMonthly,
				targetMode: "SET_ASIDE",
				targetCadence: "MONTH",
				targetCurrency: null,
			},
		});
	forgetMonthViews(tx);
	return {
		plan: planDto(saved, H),
		previous: before ? planDto(before, H) : null,
	};
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
			foreignRateType: "official",
		},
		ctx,
	);
	if (!v.ok) return null;
	return fromMinor(v.minor, ctx.bookCurrency).div(1_000_000);
}

async function valuationFor(
	tx: Tx,
	book: Awaited<ReturnType<typeof requireBook>>,
	currencies: readonly string[],
	today: string,
): Promise<ValuationContext> {
	const rates = await RateBook.load(tx, {
		bookCurrency: book.currency,
		rateTypes: [
			...new Set(["official", ...book.periods.map((p) => p.rateType)]),
		],
		since: addDays(today, -31),
		extraCurrencies: currencies,
	});
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
export async function projectIn(
	tx: Tx,
	userId: string,
	input: PayoffProjectInput,
	now: Date,
): Promise<PayoffProjection> {
	const book = await requireBook(tx, userId);
	const H = book.currency;
	const saved = await getPayoffPlan(tx, userId);
	const plan: PayoffPlanDto = {
		...saved,
		strategy: input.strategy ?? saved.strategy,
		extraMonthly:
			input.extraMonthlyMinor === undefined
				? saved.extraMonthly
				: { minor: input.extraMonthlyMinor, currency: H },
		customOrder: input.customOrder ?? saved.customOrder,
	};
	const today = isoDateIn(now, book.timeZone);
	const all = (await liabilitiesOf(tx)).filter((a) => dec(a.balance).gt(0));
	const ctx = await valuationFor(
		tx,
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
