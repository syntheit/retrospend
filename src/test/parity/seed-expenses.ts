/**
 * The expenses of the parity ledger (E2EE P16): random rows over the span,
 * with refunds, income, drafts, hidden rows, NOT_SPENDING, an INCOME category
 * and amortized parents with children; one row of each currency at every
 * period edge; and the parent every leg names. Written in chunks through
 * fixtureDb.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "~prisma";
import { fixtureDb } from "../pg-harness";
import { book } from "./rates";
import {
	CURRENCIES,
	chunks,
	D,
	DAY,
	type SeedContext,
	SPAN_START,
	text,
} from "./seed-context";

type Row = Prisma.ExpenseCreateManyInput;

interface ExpenseSpec {
	minor: number;
	currency: string;
	at: Date;
	direction?: "OUT" | "IN";
	inType?: "INCOME" | "REFUND";
	status?: "DRAFT" | "FINALIZED";
	hidden?: boolean;
	entryKind?: "STANDARD" | "NOT_SPENDING";
	categoryId?: string | null;
	parent?: boolean;
	parentId?: string;
	booking?: string | null;
}

/** Adds a row (to the children when `child`), returns its id. */
type Add = (spec: ExpenseSpec, child?: boolean) => string;

/** Home-leg booking types by home currency: ARS has blue and official, the others official. */
const bookingTypes = (home: string) =>
	home === "ARS" ? (["blue", "official"] as const) : (["official"] as const);

/** The rate type a row is booked at, or null when it is saved unbooked. */
function bookingOf(ctx: SeedContext, currency: string): string | null {
	const r = ctx.rnd();
	const booked = currency === ctx.home ? r < 0.85 : r < 0.6;
	return booked ? ctx.pick(bookingTypes(ctx.home)) : null;
}

function expenseRow(
	ctx: SeedContext,
	title: string,
	id: string,
	o: ExpenseSpec,
): Row {
	const amount = text(o.minor, o.currency);
	const money = book(amount, o.currency, o.at, ctx.home, o.booking ?? null);
	return {
		id,
		userId: ctx.userId,
		title,
		description: ctx.rnd() < 0.2 ? "a note" : null,
		amount: D(amount),
		currency: o.currency,
		date: o.at,
		categoryId: o.categoryId ?? null,
		pricingSource: "MANUAL",
		status: o.status ?? "FINALIZED",
		direction: o.direction ?? "OUT",
		entryKind: o.entryKind ?? "STANDARD",
		inType: o.entryKind === "NOT_SPENDING" ? null : (o.inType ?? null),
		excludeFromAnalytics: o.hidden ?? false,
		isAmortizedParent: o.parent ?? false,
		isAmortizedChild: o.parentId !== undefined,
		parentId: o.parentId ?? null,
		exchangeRate: D(money.exchangeRate),
		amountInUSD: D(money.amountInUSD),
		rateType: money.rateType,
		homeCurrency: money.homeCurrency,
		homeRate: money.homeRate === null ? null : D(money.homeRate),
		homeAmount: money.homeAmount === null ? null : D(money.homeAmount),
	};
}

/** Random rows: each draws a kind, so every case the figures branch on is present. */
function addRandomExpenses(ctx: SeedContext, add: Add): void {
	for (let i = 0; i < ctx.size.expenses; i++) {
		const currency = ctx.pick(CURRENCIES);
		const base = {
			minor: ctx.amountOf(currency),
			currency,
			at: ctx.dateOf(),
			booking: bookingOf(ctx, currency),
			categoryId: ctx.rnd() < 0.5 ? ctx.pick(ctx.categoryIds) : null,
		};
		const r = ctx.rnd();
		if (r < 0.07) add({ ...base, direction: "IN", inType: "REFUND" });
		else if (r < 0.12) add({ ...base, direction: "IN", inType: "INCOME" });
		else if (r < 0.16) add({ ...base, status: "DRAFT" });
		else if (r < 0.2) add({ ...base, hidden: true });
		else if (r < 0.24) add({ ...base, entryKind: "NOT_SPENDING" });
		else if (r < 0.27) add({ ...base, categoryId: ctx.incomeCategory });
		else if (r < 0.3) {
			const parent = add({ ...base, parent: true });
			for (let c = 0; c < 3; c++)
				add(
					{
						...base,
						minor: Math.max(1, Math.floor(base.minor / 3)),
						at: new Date(base.at.getTime() + c * 30 * DAY),
						parentId: parent,
					},
					true,
				);
		} else add(base);
	}
}

/** One row of each currency at every edge instant, some of them money in. */
function addEdgeExpenses(ctx: SeedContext, add: Add): void {
	ctx.edgeAts.forEach((at, i) => {
		const currency = CURRENCIES[i % CURRENCIES.length] as string;
		add({
			minor: ctx.amountOf(currency),
			currency,
			at,
			booking: bookingOf(ctx, currency),
			direction: i % 7 === 0 ? "IN" : "OUT",
			inType: i % 7 === 0 ? (i % 2 === 0 ? "REFUND" : "INCOME") : undefined,
		});
	});
}

export interface SeededExpenses {
	ids: string[];
	/** Every row written, children included. */
	count: number;
	/** The row every leg that names an expense points at (kept out of spending and money in). */
	legParent: string;
}

export async function seedExpenses(ctx: SeedContext): Promise<SeededExpenses> {
	const rows: Row[] = [];
	const children: Row[] = [];
	const add: Add = (spec, child = false) => {
		const id = randomUUID();
		const title = `row ${rows.length + children.length}`;
		(child ? children : rows).push(expenseRow(ctx, title, id, spec));
		return id;
	};
	addRandomExpenses(ctx, add);
	addEdgeExpenses(ctx, add);
	// A currency with no rate at all.
	if (ctx.profile.withMissingRate)
		add({ minor: 1234, currency: "XQZ", at: new Date(ctx.edgeAts[0] as Date) });
	const legParent = add({
		minor: 100,
		currency: "ARS",
		at: new Date(SPAN_START),
		entryKind: "NOT_SPENDING",
	});
	// Parents first: a child names its parent.
	for (const part of chunks(rows, 1000))
		await fixtureDb.expense.createMany({ data: part });
	for (const part of chunks(children, 1000))
		await fixtureDb.expense.createMany({ data: part });
	return {
		ids: rows.map((r) => r.id as string),
		count: rows.length + children.length,
		legParent,
	};
}
