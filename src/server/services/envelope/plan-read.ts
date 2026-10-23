/**
 * Plan cost, runway and the year view (SPEC §5.13, E6, B15, D9, D55, D66).
 *
 * - Plan cost: Σ monthly-equivalent targets (a weekly target × weeks, a bill
 *   per month of its repeat, a goal's monthly need), a group counting its
 *   own target when that is larger than its children, against typical
 *   income (median budget income of the last 3 closed months).
 * - Runway, on demand: (To assign + Σ Left + money goals hold in Wealth) /
 *   essential plan cost, in whole tenths of a month rounded down.
 *   Essentials default to the Bills group and every bill.
 * - Year view: envelopes by month (assigned, spent, left) from one engine
 *   pass. Months before the budget started show spending only (own rows
 *   through today's category links; shares are not in it).
 */
import type { GetMonthOutput } from "~/lib/schemas/envelope";
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
import { typicalIncome } from "./groups";
import { closedIncomes } from "./income-history";
import { type LoadedBook, loadBook } from "./inputs";
import { freeze } from "./load-state";
import { type MonthRead, monthViewIn } from "./month-read";
import type { ViewEnvelope } from "./month-view";
import { monthStart } from "./months";
import {
	type PlanCostTarget,
	planCost,
	runway,
	savingsOutsideEnvelopes,
} from "./plan-cost";
import type { Minor, MonthKey } from "./types";
import { sumMinor } from "./units";

type Tx = Prisma.TransactionClient;
type Row = GetMonthOutput["groups"][number]["envelopes"][number];

function costTarget(env: ViewEnvelope, row: Row | undefined): PlanCostTarget {
	const t = env.target;
	const dto = row?.target;
	if (!t || !dto) return { kind: "NONE" };
	if (t.kind === "MONTHLY")
		return {
			kind: "MONTHLY",
			// The DTO amount is already this month's X (weekly x weeks).
			target: { amount: dto.amount?.minor ?? 0, mode: t.mode, cadence: "MONTH" },
			weeksInMonth: 1,
		};
	if (t.kind === "BILL")
		return {
			kind: "BILL",
			amount: t.amount,
			repeatMonths: t.repeatMonths,
			needThisMonth: dto.need.minor,
		};
	return {
		kind: "SAVINGS",
		monthlyNeed: t.monthly ?? dto.perMonth?.minor ?? dto.need.minor,
	};
}

/** Money goals hold outside their envelopes: moved to Wealth, or a dedicated account today. */
function savingsOutside(loaded: LoadedBook, c: MonthKey): Minor {
	const state = computeBook(loaded.input, c);
	const moved = new Map<string, Minor>();
	for (const a of loaded.input.activity) {
		if (a.source !== "WEALTH" || a.month > c) continue;
		const id = state.envelopeOf(a);
		moved.set(id, (moved.get(id) ?? 0) - a.minor);
	}
	return savingsOutsideEnvelopes(
		loaded.book.envelopes
			.filter((e) => e.kind === "SAVINGS" && !e.archived)
			.map((e) => ({
				toWealth: moved.get(e.id) ?? 0,
				fromWealth: 0,
				dedicatedAccountValue: e.dedicatedValue ?? null,
			})),
	);
}

export async function planCostIn(
	tx: Tx,
	userId: string,
	input: PlanCostInput,
	now: Date,
): Promise<PlanCostDto> {
	const current = await monthViewIn(tx, userId, now);
	if (!current) throw new EnvelopeError("NO_BOOK", "start a budget first");
	const { loaded } = current;
	const c = loaded.input.currentMonth;
	const month = input.month ?? c;
	if (month !== c && month !== addMonths(c, 1))
		throw new EnvelopeError("INVALID", "plan cost is for this month or the next");
	const view = ((await monthViewIn(tx, userId, now, month)) as MonthRead).dto;
	const rows = new Map(view.groups.flatMap((g) => g.envelopes).map((r) => [r.id, r]));
	const live = loaded.book.envelopes.filter((e) => !e.archived);
	const all = live.map((e) => ({ id: e.id, groupId: e.groupId, target: costTarget(e, rows.get(e.id)) }));
	const groupTargets = new Map(
		view.groups.flatMap((g) => (g.id && g.target?.amount ? [[g.id, g.target.amount.minor] as const] : [])),
	);
	const cost = planCost(all, groupTargets);
	const bills = new Set(loaded.book.groups.filter((g) => g.role === "BILLS").map((g) => g.id));
	const essentialIds =
		input.essentialIds ??
		live.filter((e) => e.kind === "BILL" || (e.groupId && bills.has(e.groupId))).map((e) => e.id);
	const essential = planCost(all.filter((e) => essentialIds.includes(e.id)), new Map()).total;
	const closed = await closedIncomes(tx, loaded);
	const typical = typicalIncome(closed.months);
	const H = loaded.book.currency;
	const money = (minor: Minor) => ({ minor, currency: H });
	const leftNow = sumMinor(current.dto.groups.flatMap((g) => g.envelopes).map((r) => r.left.minor));
	const run = runway({
		toAssign: current.dto.toAssign.amount.minor,
		sumLeft: leftNow,
		savingsOutside: savingsOutside(loaded, c),
		essentialPlanCost: essential,
	});
	return {
		month,
		cost: money(cost.total),
		byGroup: [...cost.byGroup].map(([groupId, v]) => ({ groupId, cost: money(v) })),
		typicalIncome: typical === null ? null : money(typical),
		closedMonths: closed.months.length,
		essentialCost: money(essential),
		essentialIds,
		runway: run ? { available: money(run.available), tenths: run.tenths } : null,
		incomplete:
			view.incomplete || closed.incomplete || live.some((e) => e.targetIncomplete),
	};
}

/** Own spending before the budget started, per envelope and month, through today's links (D9). */
async function spendingBefore(
	tx: Tx,
	loaded: LoadedBook,
	from: Date,
): Promise<Map<string, Minor>> {
	const userId = loaded.row.createdById;
	const range = { gte: from, lte: new Date(loaded.row.startDate.getTime() - 1) };
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
	const out = await tx.expense.findMany({ where: budgetSpendingWhere(userId, range), select });
	const back = await tx.expense.findMany({ where: budgetRefundWhere(userId, range), select });
	const link = new Map<string, string>();
	for (const e of loaded.book.envelopes)
		for (const cat of e.categoryIds) link.set(cat, e.id);
	const cells = new Map<string, Minor>();
	for (const [rows, sign] of [[out, 1], [back, -1]] as const)
		for (const r of rows) {
			const { date, month } = loaded.valuer.dated(r.date);
			const v = loaded.valuer.value(r, date, month);
			if (v === null) continue;
			const env = (r.categoryId && link.get(r.categoryId)) || loaded.book.defaultEnvelopeId;
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
		m < start ? "BEFORE_START" : m < c ? "CLOSED" : m === c ? "OPEN" : m === addMonths(c, 1) ? "NEXT" : "LATER";
	const envelopes = loaded.book.envelopes
		.filter((e) => !e.archived)
		.map((e) => ({
			id: e.id,
			groupId: e.groupId,
			cells: months.map((m) => {
				const s = stateOf(m);
				if (s === "BEFORE_START")
					return { month: m, assigned: null, spent: money(before.get(`${e.id}:${m}`) ?? 0), left: null };
				if (s === "LATER") return { month: m, assigned: null, spent: money(0), left: null };
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
		incomplete: loaded.missingRates.length > 0 || loaded.valuer.missingRates.length > missing,
	};
}
