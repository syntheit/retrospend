/**
 * allocatePayment (MONEY-MOVES §1.2): how one payment pays a pair's open
 * debts. Pure and the only allocator: the settle sheet's "This pays", the
 * preview and the recorded rows all come from it.
 *
 * 1. Payment currency first: its debts across scopes, oldest open debt first
 *    (ties: Outside projects, then project id).
 * 2. The remainder converts at the payment's quotes into the other
 *    currencies' debts, oldest first.
 * 3. A scope is paid at most to zero (no side effects, I3).
 * 4. "Everything" (the net the payer owes) with debts going the other way
 *    also writes offsets, so every scope ends at zero; offsets may cross
 *    currencies at the payment's quotes. A partial payment never offsets.
 * 5. Dust (MONEY-MOVES §1.2 rule 5): a remainder smaller than one minor
 *    unit of its currency after conversion, or under ARS 1 for ARS. A debt
 *    left with dust is closed, and payment dust goes to the last row (I2:
 *    the rows add up to the payment exactly).
 * 6. More than everything owed (net, all currencies at the payment's
 *    quotes) is an overpayment: reported, and recorded only with
 *    `allowOverpay`, as an excess row Outside projects in the payment
 *    currency (owner Q2).
 * 7. "Apply to" runs the same rules inside the chosen scopes and currencies.
 *
 * A debt currency without a quote is left untouched and listed in
 * `unpriced`: a missing rate is never 1 (R14).
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { currencyDecimals } from "~/lib/money";
import {
	dec,
	fromMinor,
	sumMinor,
	toMinor,
} from "~/server/services/envelope/units";
import type { ApplyTo, Minor, PairLine, Quote, Scope } from "./types";

export interface AllocateInput {
	/** The pair's lines, signed from the payer's side (see PairLine). */
	readonly lines: readonly PairLine[];
	/** The payment currency. */
	readonly currency: string;
	/** What is paid, in minor units of `currency`; null pays everything. */
	readonly amount: Minor | null;
	/** One quote per other currency the payment may convert into. */
	readonly quotes: ReadonlyMap<string, Quote>;
	readonly applyTo?: readonly ApplyTo[];
	readonly allowOverpay?: boolean;
}

/** Cash paid into one scope and debt currency. */
export interface CashRow {
	readonly scope: Scope;
	readonly currency: string;
	/** Debt cleared, in minor units of `currency`. */
	readonly amount: Minor;
	/** Cash it took, in minor units of the payment currency. */
	readonly paid: Minor;
	/** The conversion used; null when `currency` is the payment currency. */
	readonly quote: Quote | null;
	/** The confirmed overpayment, Outside projects. */
	readonly excess: boolean;
}

/** A debt cancelled against an opposite one; moves no cash. */
export interface OffsetRow {
	readonly scope: Scope;
	readonly currency: string;
	readonly amount: Minor;
	/** Who owed the cancelled debt. */
	readonly from: "payer" | "payee";
	/** Its value in the payment currency; the two sides add up to the same total (I2). */
	readonly value: Minor;
	readonly quote: Quote | null;
}

export interface Allocation {
	readonly currency: string;
	/** The payment amount the rows add up to. */
	readonly amount: Minor;
	/** The "Everything" figure: what the payer owes net, in the payment currency (never negative). */
	readonly full: Minor;
	/** Everything the payer owes, not netted against what is owed back. */
	readonly gross: Minor;
	readonly everything: boolean;
	readonly rows: readonly CashRow[];
	readonly offsets: readonly OffsetRow[];
	/** What the payer still owes after this payment, per scope and currency. */
	readonly remainder: readonly {
		scope: Scope;
		currency: string;
		amount: Minor;
	}[];
	/** Cash beyond everything owed (0 when none). Recorded only with allowOverpay. */
	readonly overpay: Minor;
	/** Debt currencies left untouched because they have no quote. */
	readonly unpriced: readonly string[];
}

/**
 * The smallest amount that is not dust in `currency`, in its minor units:
 * ARS 1 for ARS (pesos are shown whole), one minor unit for every other
 * currency. The ARS rule is the owner's and is not extended to other
 * currencies shown whole.
 */
export function dustOf(currency: string): Minor {
	return currency.toUpperCase() === "ARS" ? 10 ** currencyDecimals("ARS") : 1;
}

/**
 * A non-negative amount to the nearest dust step, half up: the one
 * "Everything" figure a whole-peso user can type (ARS 165,987.50 is
 * ARS 165,988). Paying it leaves only dust, which the rows absorb.
 */
function roundToDust(minor: Minor, currency: string): Minor {
	const step = dustOf(currency);
	return Math.floor((2 * minor + step) / (2 * step)) * step;
}

/** Payment-currency minor units worth `minor` of `currency` at `quote`, rounded half-even. */
export function toPaymentCurrency(
	minor: Minor,
	currency: string,
	paymentCurrency: string,
	quote: Quote | null,
): Minor {
	if (currency === paymentCurrency) return minor;
	if (!quote) throw new RangeError(`no quote for ${currency}`);
	return toMinor(
		fromMinor(minor, currency).mul(quote.perUnit),
		paymentCurrency,
	);
}

/** Minor units of `currency` that `paidMinor` of the payment currency buys at `quote`. */
function fromPaymentCurrency(
	paidMinor: Minor,
	currency: string,
	paymentCurrency: string,
	quote: Quote | null,
): Minor {
	if (currency === paymentCurrency) return paidMinor;
	if (!quote) throw new RangeError(`no quote for ${currency}`);
	return toMinor(
		fromMinor(paidMinor, paymentCurrency).div(dec(quote.perUnit)),
		currency,
	);
}

/** Payment currency first, then oldest open debt, then Outside projects, then project id. */
function debtOrder(paymentCurrency: string) {
	return (a: PairLine, b: PairLine): number => {
		const cur =
			Number(a.currency !== paymentCurrency) -
			Number(b.currency !== paymentCurrency);
		if (cur !== 0) return cur;
		const ao = a.oldest ?? "9999-12-31";
		const bo = b.oldest ?? "9999-12-31";
		if (ao !== bo) return ao < bo ? -1 : 1;
		if (a.scope !== b.scope) {
			if (a.scope === null) return -1;
			if (b.scope === null) return 1;
			return a.scope < b.scope ? -1 : 1;
		}
		return a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;
	};
}

function inApplyTo(line: PairLine, applyTo: readonly ApplyTo[] | undefined) {
	if (!applyTo) return true;
	return applyTo.some(
		(a) =>
			(a.scope === undefined || a.scope === line.scope) &&
			(!a.currency || a.currency === line.currency),
	);
}

interface OpenDebt extends PairLine {
	left: Minor;
}

interface Pricing {
	readonly paymentCurrency: string;
	readonly quotes: ReadonlyMap<string, Quote>;
}

const quoteFor = (p: Pricing, currency: string): Quote | null =>
	currency === p.paymentCurrency ? null : (p.quotes.get(currency) ?? null);

const worth = (p: Pricing, minor: Minor, currency: string): Minor =>
	toPaymentCurrency(minor, currency, p.paymentCurrency, quoteFor(p, currency));

/** Pays `amount` into the debts in order; returns the rows and the cash left. */
function payCash(
	pricing: Pricing,
	debts: OpenDebt[],
	amount: Minor,
): { rows: CashRow[]; rest: Minor } {
	const P = pricing.paymentCurrency;
	const dustP = dustOf(P);
	const rows: CashRow[] = [];
	let rest = amount;
	for (const debt of debts) {
		if (rest <= 0) break;
		const quote = quoteFor(pricing, debt.currency);
		const need = worth(pricing, debt.left, debt.currency);
		let cleared: Minor;
		let paid: Minor;
		if (rest >= need || need - rest < dustP) {
			cleared = debt.left;
			paid = Math.min(rest, need);
		} else {
			paid = rest;
			cleared = Math.min(
				debt.left,
				fromPaymentCurrency(rest, debt.currency, P, quote),
			);
			if (debt.left - cleared < dustOf(debt.currency)) cleared = debt.left;
		}
		rows.push({
			scope: debt.scope,
			currency: debt.currency,
			amount: cleared,
			paid,
			quote,
			excess: false,
		});
		debt.left -= cleared;
		rest -= paid;
	}
	return { rows, rest };
}

/**
 * Offsets for "Everything": every opposite debt in full, then every payer
 * debt the cash did not reach, so each scope ends at zero. The payer side's
 * values are made to add up to the payee side's exactly (I2): the last row
 * takes the rounding.
 */
function writeOffsets(
	pricing: Pricing,
	opposite: readonly PairLine[],
	debts: OpenDebt[],
): OffsetRow[] {
	const theirs: OffsetRow[] = opposite.map((line) => ({
		scope: line.scope,
		currency: line.currency,
		amount: -line.owed,
		from: "payee",
		value: worth(pricing, -line.owed, line.currency),
		quote: quoteFor(pricing, line.currency),
	}));
	const total = sumMinor(theirs.map((o) => o.value));
	const open = debts.filter((d) => d.left > 0);
	const mine: OffsetRow[] = open.map((debt) => ({
		scope: debt.scope,
		currency: debt.currency,
		amount: debt.left,
		from: "payer",
		value: worth(pricing, debt.left, debt.currency),
		quote: quoteFor(pricing, debt.currency),
	}));
	const last = mine.at(-1);
	if (last) {
		const others = sumMinor(mine.slice(0, -1).map((o) => o.value));
		mine[mine.length - 1] = { ...last, value: total - others };
	}
	for (const debt of open) debt.left = 0;
	return [...theirs, ...mine];
}

/** Adds the payment's dust to the last row, or books the excess (rule 5, 6). */
function settleRest(
	rows: CashRow[],
	rest: Minor,
	paymentCurrency: string,
	allowOverpay: boolean,
): Minor {
	const last = rows.at(-1);
	if (rest > 0 && last && rest < dustOf(paymentCurrency)) {
		rows[rows.length - 1] = { ...last, paid: last.paid + rest };
		return 0;
	}
	if (rest > 0 && allowOverpay) {
		rows.push({
			scope: null,
			currency: paymentCurrency,
			amount: rest,
			paid: rest,
			quote: null,
			excess: true,
		});
	}
	return Math.max(0, rest);
}

export function allocatePayment(input: AllocateInput): Allocation {
	const P = input.currency;
	const pricing: Pricing = { paymentCurrency: P, quotes: input.quotes };
	if (
		input.amount !== null &&
		!(Number.isSafeInteger(input.amount) && input.amount >= 0)
	) {
		throw new RangeError(
			`payment amount must be a non-negative integer, got ${input.amount}`,
		);
	}

	const unpriced = new Set<string>();
	const priced = input.lines.filter((line) => {
		if (line.owed === 0 || !inApplyTo(line, input.applyTo)) return false;
		if (line.currency === P || input.quotes.has(line.currency)) return true;
		unpriced.add(line.currency);
		return false;
	});
	const order = debtOrder(P);
	const debts: OpenDebt[] = priced
		.filter((l) => l.owed > 0)
		.sort(order)
		.map((l) => ({ ...l, left: l.owed }));
	const opposite = priced.filter((l) => l.owed < 0).sort(order);

	const gross = sumMinor(debts.map((d) => worth(pricing, d.owed, d.currency)));
	const owedBack = sumMinor(
		opposite.map((o) => worth(pricing, -o.owed, o.currency)),
	);
	const full = roundToDust(Math.max(0, gross - owedBack), P);
	const amount = input.amount ?? full;
	const dustP = dustOf(P);

	// "Everything" exists when the payer owes on balance (or is even). Paying
	// it, or more, also offsets the debts going the other way, and the cash is
	// the net: anything above it is an overpayment.
	const owesOnBalance = owedBack - gross < dustP;
	const everything =
		opposite.length > 0 && owesOnBalance && amount > full - dustP;
	const cash = everything ? Math.min(amount, full) : amount;

	const paid = payCash(pricing, debts, cash);
	const rows = paid.rows;
	const offsets = everything ? writeOffsets(pricing, opposite, debts) : [];
	const rest = settleRest(
		rows,
		paid.rest + (amount - cash),
		P,
		input.allowOverpay === true,
	);
	// Only what goes beyond every debt is excess; when the payee owes more
	// overall the payment still only pays down the payer's own debts.
	const overpay = rest;

	return {
		currency: P,
		amount,
		full,
		gross,
		everything,
		rows,
		offsets,
		remainder: debts
			.filter((d) => d.left > 0)
			.map((d) => ({ scope: d.scope, currency: d.currency, amount: d.left })),
		overpay,
		unpriced: [...unpriced].sort(),
	};
}

/** A quote from a decimal rate (string, never a float). */
export function quote(perUnit: string | Decimal, rateType: string): Quote {
	return { perUnit: dec(perUnit), rateType };
}

/** One settlement row to write for an allocation, seen from the payer. */
export interface PlannedSettlement {
	readonly scope: Scope;
	readonly currency: string;
	readonly amount: Minor;
	/** "payee" rows run payee to payer: offsets of what the payee owed. */
	readonly from: "payer" | "payee";
	readonly isOffset: boolean;
	/** Cash in the payment currency (0 on offsets). */
	readonly paid: Minor;
	readonly quote: Quote | null;
}

/** The rows a payment writes: cash rows first, then offsets. */
export function plannedSettlements(
	allocation: Allocation,
): PlannedSettlement[] {
	return [
		...allocation.rows.map((r) => ({
			scope: r.scope,
			currency: r.currency,
			amount: r.amount,
			from: "payer" as const,
			isOffset: false,
			paid: r.paid,
			quote: r.quote,
		})),
		...allocation.offsets.map((o) => ({
			scope: o.scope,
			currency: o.currency,
			amount: o.amount,
			from: o.from,
			isOffset: true,
			paid: 0,
			quote: o.quote,
		})),
	];
}
