/**
 * Plan cost and runway (SPEC §5.13, E6, B15, D9, D55, D66), from a source.
 *
 * - Plan cost: Σ monthly-equivalent targets (a weekly target × weeks, a bill
 *   per month of its repeat, a goal's monthly need), a group counting its
 *   own target when that is larger than its children, against typical
 *   income (median budget income of the last 3 closed months).
 * - Runway, on demand: (To assign + Σ Left + money goals hold in Wealth) /
 *   essential plan cost, in whole tenths of a month rounded down.
 *   Essentials default to the Bills group and every bill.
 *
 * Pure: the server reads the month view and the closed incomes through its
 * transaction (server/services/envelope/plan-read.ts), a device from its
 * own store.
 */
import type { BookRowCore, CloseRowCore, LoadedBook } from "./book-source";
import { addMonths } from "./calendar";
import type { EnvelopeRowDto, PlanCostDto } from "./dto";
import { computeBook } from "./engine";
import { EnvelopeError } from "./errors";
import { typicalIncome } from "./groups";
import type { ClosedIncomes } from "./income-history";
import type { MonthRead } from "./month-read";
import type { ViewEnvelope } from "./month-view";
import {
	type PlanCostTarget,
	planCost,
	runway,
	savingsOutsideEnvelopes,
} from "./plan-cost";
import type { Minor, MonthKey } from "./types";
import { sumMinor } from "./units";

/** What a plan cost request narrows: another month, or other envelopes as the essentials. */
export interface PlanCostRequest {
	month?: MonthKey;
	essentialIds?: readonly string[];
}

/** What plan cost reads. */
export interface PlanSource<
	R extends BookRowCore = BookRowCore,
	C extends CloseRowCore = CloseRowCore,
> {
	/** The month view of `month` (default: the current month); null without a book. */
	view(month?: MonthKey): Promise<MonthRead<R, C> | null>;
	closedIncomes(loaded: LoadedBook<R, C>): Promise<ClosedIncomes>;
}

function costTarget(
	env: ViewEnvelope,
	row: EnvelopeRowDto | undefined,
): PlanCostTarget {
	const t = env.target;
	const dto = row?.target;
	if (!t || !dto) return { kind: "NONE" };
	if (t.kind === "MONTHLY")
		return {
			kind: "MONTHLY",
			// The DTO amount is already this month's X (weekly x weeks).
			target: {
				amount: dto.amount?.minor ?? 0,
				mode: t.mode,
				cadence: "MONTH",
			},
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
export function savingsOutside(
	loaded: Pick<LoadedBook, "input" | "book">,
	c: MonthKey,
): Minor {
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

export async function planCostFrom<
	R extends BookRowCore,
	C extends CloseRowCore,
>(src: PlanSource<R, C>, input: PlanCostRequest): Promise<PlanCostDto> {
	const current = await src.view();
	if (!current) throw new EnvelopeError("NO_BOOK", "start a budget first");
	const { loaded } = current;
	const c = loaded.input.currentMonth;
	const month = input.month ?? c;
	if (month !== c && month !== addMonths(c, 1))
		throw new EnvelopeError(
			"INVALID",
			"plan cost is for this month or the next",
		);
	const view = ((await src.view(month)) as MonthRead<R, C>).dto;
	const rows = new Map(
		view.groups.flatMap((g) => g.envelopes).map((r) => [r.id, r]),
	);
	const live = loaded.book.envelopes.filter((e) => !e.archived);
	const all = live.map((e) => ({
		id: e.id,
		groupId: e.groupId,
		target: costTarget(e, rows.get(e.id)),
	}));
	const groupTargets = new Map(
		view.groups.flatMap((g) =>
			g.id && g.target?.amount ? [[g.id, g.target.amount.minor] as const] : [],
		),
	);
	const cost = planCost(all, groupTargets);
	const bills = new Set(
		loaded.book.groups.filter((g) => g.role === "BILLS").map((g) => g.id),
	);
	const essentialIds =
		input.essentialIds ??
		live
			.filter((e) => e.kind === "BILL" || (e.groupId && bills.has(e.groupId)))
			.map((e) => e.id);
	const essential = planCost(
		all.filter((e) => essentialIds.includes(e.id)),
		new Map(),
	).total;
	const closed = await src.closedIncomes(loaded);
	const typical = typicalIncome(closed.months);
	const H = loaded.book.currency;
	const money = (minor: Minor) => ({ minor, currency: H });
	const leftNow = sumMinor(
		current.dto.groups.flatMap((g) => g.envelopes).map((r) => r.left.minor),
	);
	const run = runway({
		toAssign: current.dto.toAssign.amount.minor,
		sumLeft: leftNow,
		savingsOutside: savingsOutside(loaded, c),
		essentialPlanCost: essential,
	});
	return {
		month,
		cost: money(cost.total),
		byGroup: [...cost.byGroup].map(([groupId, v]) => ({
			groupId,
			cost: money(v),
		})),
		typicalIncome: typical === null ? null : money(typical),
		closedMonths: closed.months.length,
		essentialCost: money(essential),
		essentialIds: [...essentialIds],
		runway: run
			? { available: money(run.available), tenths: run.tenths }
			: null,
		incomplete:
			view.incomplete ||
			closed.incomplete ||
			live.some((e) => e.targetIncomplete),
	};
}
