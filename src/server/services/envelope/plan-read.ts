/**
 * Plan cost, runway and the year view (SPEC §5.13, E6, B15, D9, D55, D66).
 *
 * - Plan cost and runway are pure over a source and live in
 *   @retrospend/domain/envelope/plan-read, shared with devices; here: the
 *   source over this transaction's month views and closed incomes.
 * - Year view: envelopes by month (assigned, spent, left) from one engine
 *   pass. Months before the budget started show spending only (own rows
 *   through today's category links; shares are not in it).
 */
import { planCostFrom } from "@retrospend/domain/envelope/plan-read";
import type {
	PlanCostDto,
	PlanCostInput,
	YearViewDto,
} from "~/lib/schemas/envelope-plan";
import type { Prisma } from "~prisma";
import { budgetRefundWhere, budgetSpendingWhere } from "../spending";
import { addMonths } from "./calendar";
import { computeBook } from "./engine";
import { EnvelopeError } from "./errors";
import { closedIncomes } from "./income-history";
import { type LoadedBook, loadBook } from "./inputs";
import { freeze } from "./load-state";
import { monthViewIn } from "./month-read";
import { monthStart } from "./months";
import type { Minor, MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

export function planCostIn(
	tx: Tx,
	userId: string,
	input: PlanCostInput,
	now: Date,
): Promise<PlanCostDto> {
	return planCostFrom(
		{
			view: (month) => monthViewIn(tx, userId, now, month),
			closedIncomes: (loaded) => closedIncomes(tx, loaded),
		},
		input,
	);
}

/** Own spending before the budget started, per envelope and month, through today's links (D9). */
async function spendingBefore(
	tx: Tx,
	loaded: LoadedBook,
	from: Date,
): Promise<Map<string, Minor>> {
	const userId = loaded.row.createdById;
	const range = {
		gte: from,
		lte: new Date(loaded.row.startDate.getTime() - 1),
	};
	const select = {
		id: true,
		amount: true,
		currency: true,
		amountInUSD: true,
		homeCurrency: true,
		homeAmount: true,
		date: true,
		categoryId: true,
	} as const;
	const out = await tx.expense.findMany({
		where: budgetSpendingWhere(userId, range),
		select,
	});
	const back = await tx.expense.findMany({
		where: budgetRefundWhere(userId, range),
		select,
	});
	const link = new Map<string, string>();
	for (const e of loaded.book.envelopes)
		for (const cat of e.categoryIds) link.set(cat, e.id);
	const cells = new Map<string, Minor>();
	for (const [rows, sign] of [
		[out, 1],
		[back, -1],
	] as const)
		for (const r of rows) {
			const { date, month } = loaded.valuer.dated(r.date);
			const v = loaded.valuer.value(r, date, month);
			if (v === null) continue;
			const env =
				(r.categoryId && link.get(r.categoryId)) ||
				loaded.book.defaultEnvelopeId;
			const key = `${env}:${month}`;
			cells.set(key, (cells.get(key) ?? 0) + sign * v);
		}
	await freeze(tx, loaded.row.id, loaded.valuer);
	return cells;
}

export async function yearViewIn(
	tx: Tx,
	userId: string,
	year: number | undefined,
	now: Date,
): Promise<YearViewDto> {
	const head = await loadBook(tx, userId, { now });
	if (!head) throw new EnvelopeError("NO_BOOK", "start a budget first");
	const c = head.input.currentMonth;
	const y = year ?? Math.floor(c / 100);
	const months = Array.from({ length: 12 }, (_, i) => y * 100 + i + 1);
	const first = months[0] as MonthKey;
	const loaded =
		first > head.book.startMonth
			? await loadBook(tx, userId, { now, needFrom: first })
			: await loadBook(tx, userId, { now, needFrom: head.book.startMonth });
	if (!loaded) throw new EnvelopeError("NO_BOOK", "start a budget first");
	const start = loaded.book.startMonth;
	const missing = loaded.valuer.missingRates.length;
	const before =
		first < start
			? await spendingBefore(
					tx,
					loaded,
					new Date(`${monthStart(first, loaded.periods)}T00:00:00Z`),
				)
			: new Map<string, Minor>();
	const state = computeBook(loaded.input);
	const H = loaded.book.currency;
	const money = (minor: Minor) => ({ minor, currency: H });
	const stateOf = (m: MonthKey) =>
		m < start
			? "BEFORE_START"
			: m < c
				? "CLOSED"
				: m === c
					? "OPEN"
					: m === addMonths(c, 1)
						? "NEXT"
						: "LATER";
	const envelopes = loaded.book.envelopes
		.filter((e) => !e.archived)
		.map((e) => ({
			id: e.id,
			groupId: e.groupId,
			cells: months.map((m) => {
				const s = stateOf(m);
				if (s === "BEFORE_START")
					return {
						month: m,
						assigned: null,
						spent: money(before.get(`${e.id}:${m}`) ?? 0),
						left: null,
					};
				if (s === "LATER")
					return { month: m, assigned: null, spent: money(0), left: null };
				const em = state.month(m).envelopes.get(e.id);
				return {
					month: m,
					assigned: money(em?.assigned ?? 0),
					// Moves to Wealth are not spending (D24).
					spent: money(-((em?.activity ?? 0) - (em?.wealth ?? 0))),
					left: money(em?.left ?? 0),
				};
			}),
		}));
	return {
		year: y,
		months: months.map((key) => ({ key, state: stateOf(key) })),
		envelopes,
		incomplete:
			loaded.missingRates.length > 0 ||
			loaded.valuer.missingRates.length > missing,
	};
}
