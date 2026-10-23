/**
 * One budget month as the Budget page, Home and /api/v1 read it (build plan
 * 02 §5.2 getMonth): rows, group totals, To assign with its terms, Left to
 * spend, Left this week and the verdict. Pure: it shapes an engine pass and
 * the book's settings into the contract DTO, so every number on the page is
 * one of these sums (B2) and none is computed on a client (R9).
 */
import type {
	EnvelopeGroupDto,
	EnvelopeRowDto,
	EnvelopeTargetDto,
	GetMonthOutput,
	Money,
	OwedSummaryDto,
} from "~/lib/schemas/envelope";
import { addMonths, daysBetween } from "./calendar";
import type { BookState, EngineInput, EnvelopeMonth } from "./engine";
import { leftToSpendDto, verdictDto } from "./month-dto";
import { budgetMonthOf, type MonthBoundary, monthRange } from "./months";
import {
	type EnvelopeTarget,
	evaluateTarget,
	type TargetResult,
} from "./needs";
import {
	type GroupRole,
	type LeftToSpend,
	leftToSpend,
	perDay,
	weeklyPace,
	weeksOfMonth,
} from "./pace";
import type { IsoDate, Minor, MissingRate, MonthKey } from "./types";
import {
	type BudgetStyle,
	type LimitTotals,
	poolNameFor,
	type Verdict,
	verdict,
} from "./verdict";

export interface ViewEnvelope {
	id: string;
	name: string;
	icon: string | null;
	color: string | null;
	kind: "MONTHLY" | "BILL" | "SAVINGS" | "NONE";
	groupId: string | null;
	order: number;
	categoryIds: string[];
	archived: boolean;
	/** In the book currency; null without a target. */
	target: EnvelopeTarget | null;
	targetStartMonth: MonthKey | null;
	/** A target set in another currency, as set (D25). */
	foreign: Money | null;
	/** The foreign target had no rate today: left out, flagged. */
	targetIncomplete: boolean;
	/** A goal's "Only for this goal" Wealth account, valued today in H (B12). */
	dedicatedValue?: Minor | null;
}

export interface ViewGroup {
	id: string;
	name: string;
	role: GroupRole;
	order: number;
}

export interface ViewBook {
	id: string;
	style: BudgetStyle;
	fundingSource: "INCOME" | "TARGETS";
	currency: string;
	startMonth: MonthKey;
	weekStartDay: number;
	periods: readonly MonthBoundary[];
	defaultEnvelopeId: string;
	/** Switched to Just track; absent reads as not paused. */
	paused?: boolean;
	groups: readonly ViewGroup[];
	envelopes: readonly ViewEnvelope[];
}

export interface MonthViewInput {
	book: ViewBook;
	input: EngineInput;
	state: BookState;
	month: MonthKey;
	today: IsoDate;
	missingRates: readonly MissingRate[];
	/** The Owed line (owed.ts); nothing owed when omitted. */
	owed?: OwedSummaryDto;
}

/** Your shares in the month: how many found no category (D19) and what waits for your OK (D20). */
function sharesOf(p: MonthViewInput, rows: Row[]) {
	let unresolved = 0;
	for (const a of p.input.activity)
		if (
			a.source === "SHARE" &&
			a.month === p.month &&
			!a.categoryId &&
			!a.envelopeId
		)
			unresolved++;
	return {
		unresolved,
		pending: {
			minor: rows.reduce((t, r) => t + r.m.pending, 0),
			currency: p.book.currency,
		},
	};
}

/** Net spending per envelope by date, for the bill paid-early rule. */
function spendingIndex(p: MonthViewInput) {
	const byEnvelope = new Map<string, Array<{ date: IsoDate; minor: Minor }>>();
	for (const a of p.input.activity) {
		if (!a.date) continue;
		const id = p.state.envelopeOf(a);
		const list = byEnvelope.get(id) ?? [];
		list.push({ date: a.date, minor: a.minor });
		byEnvelope.set(id, list);
	}
	return (id: string, fromExclusive: IsoDate) => {
		let spent = 0;
		for (const r of byEnvelope.get(id) ?? [])
			if (r.date > fromExclusive && r.date <= p.today) spent -= r.minor;
		return Math.max(0, spent);
	};
}

interface Row {
	env: ViewEnvelope;
	m: EnvelopeMonth;
	target: TargetResult | null;
	week: ReturnType<typeof weeklyPace> | null;
	/** Current or next month: targets apply (closed months show what happened). */
	open: boolean;
}

/** Per envelope, Σ moved to Wealth minus Σ moved back, through the viewed month (goal progress, B12). */
function wealthIndex(p: MonthViewInput) {
	const moved = new Map<string, Minor>();
	for (const a of p.input.activity) {
		if (a.source !== "WEALTH" || a.month > p.month) continue;
		const id = p.state.envelopeOf(a);
		moved.set(id, (moved.get(id) ?? 0) - a.minor);
	}
	return moved;
}

function rowsFor(p: MonthViewInput, c: MonthKey): Row[] {
	const range = monthRange(p.month, p.book.periods);
	const weeks = weeksOfMonth({ ...range, weekStartDay: p.book.weekStartDay });
	const spentSince = spendingIndex(p);
	const moved = wealthIndex(p);
	const monthOf = (d: IsoDate) => budgetMonthOf(d, p.book.periods);
	const s = p.state.month(p.month);
	return p.book.envelopes
		.filter((env) => !env.archived)
		.map((env) => {
			const m = s.envelopes.get(env.id) as EnvelopeMonth;
			const target =
				p.month < c || env.targetIncomplete
					? null
					: evaluateTarget(env.target, env.targetStartMonth, {
							month: p.month,
							monthFrom: range.from,
							today: p.today,
							weeksInMonth: weeks.length,
							carryIn: m.carryIn,
							assigned: m.assigned,
							left: m.left,
							movedToWealth: moved.get(env.id) ?? 0,
							dedicatedValue: env.dedicatedValue ?? null,
							monthOf,
							spentSince: (from) => spentSince(env.id, from),
						});
			const weekly =
				p.month === c &&
				env.target?.kind === "MONTHLY" &&
				env.target.cadence === "WEEK";
			const week = weekly
				? weeklyPace({
						today: p.today,
						month: { ...range, weekStartDay: p.book.weekStartDay },
						left: m.left,
						carryIn: m.carryIn,
						weekly: (env.target as Extract<EnvelopeTarget, { kind: "MONTHLY" }>)
							.amount,
						// Moves to Wealth are not spending (D24).
						spentMonthToDate: -(m.activity - m.wealth),
					})
				: null;
			return { env, m, target, week, open: p.month >= c };
		});
}

function statusOf(r: Row): EnvelopeRowDto["status"] {
	if (r.m.left < 0) return "OVERSPENT";
	if (!r.target && !(r.env.targetIncomplete && r.open)) return "NO_TARGET";
	return (r.target?.need ?? 0) > 0 ? "UNDERFUNDED" : "FUNDED";
}

function targetDto(
	r: Row,
	money: (v: Minor) => Money,
): EnvelopeTargetDto | null {
	const t = r.env.target;
	if (!r.target && !(r.env.targetIncomplete && r.open)) return null;
	const res = r.target;
	const opt = (v: Minor | null | undefined) => (v == null ? null : money(v));
	return {
		kind:
			t?.kind ??
			(r.env.kind === "BILL"
				? "BILL"
				: r.env.kind === "SAVINGS"
					? "SAVINGS"
					: "MONTHLY"),
		mode: t?.kind === "MONTHLY" ? t.mode : null,
		cadence: t?.kind === "MONTHLY" ? t.cadence : null,
		amount: opt(res?.amount),
		need: money(res?.need ?? 0),
		dueDate: res?.dueDate ?? null,
		monthsLeft: res?.monthsLeft ?? null,
		perMonth: opt(res?.perMonth),
		progress: opt(res?.progress),
		projectedMonth: res?.projectedMonth ?? null,
		totalAtDue: opt(res?.totalAtDue),
		paid: res?.paid ?? false,
		foreign: r.env.foreign,
		incomplete: r.env.targetIncomplete,
	};
}

function rowDto(
	r: Row,
	p: MonthViewInput,
	money: (v: Minor) => Money,
): EnvelopeRowDto {
	return {
		id: r.env.id,
		name: r.env.name,
		icon: r.env.icon,
		color: r.env.color,
		kind: r.env.kind,
		groupId: r.env.groupId,
		isDefault: r.env.id === p.book.defaultEnvelopeId,
		sortOrder: r.env.order,
		categoryIds: r.env.categoryIds,
		carryIn: money(r.m.carryIn),
		assigned: money(r.m.assigned),
		activity: money(r.m.activity),
		left: money(r.m.left),
		pending: money(r.m.pending),
		status: statusOf(r),
		target: targetDto(r, money),
		leftThisWeek: r.week
			? {
					amount: money(r.week.leftThisWeek),
					perDay: money(r.week.perDay),
					weekIndex: r.week.week.index,
					weeks: r.week.weeks,
					daysLeftInWeek: r.week.daysLeftInWeek,
					resetsOn: r.week.resetsOn,
				}
			: null,
	};
}

function groupsDto(
	rows: Row[],
	p: MonthViewInput,
	money: (v: Minor) => Money,
): EnvelopeGroupDto[] {
	const known = new Set(p.book.groups.map((g) => g.id));
	const slots = [
		...[...p.book.groups].sort((a, b) => a.order - b.order),
		{ id: null, name: null, role: null, order: Number.MAX_SAFE_INTEGER },
	];
	return slots
		.map((g) => {
			const mine = rows
				.filter((r) =>
					g.id === null
						? r.env.groupId === null || !known.has(r.env.groupId)
						: r.env.groupId === g.id,
				)
				.sort((a, b) => a.env.order - b.env.order);
			const sum = (f: (r: Row) => Minor) =>
				money(mine.reduce((t, r) => t + f(r), 0));
			return {
				id: g.id,
				name: g.name,
				role: g.role,
				sortOrder: g.order === Number.MAX_SAFE_INTEGER ? 9999 : g.order,
				totals: {
					carryIn: sum((r) => r.m.carryIn),
					assigned: sum((r) => r.m.assigned),
					activity: sum((r) => r.m.activity),
					left: sum((r) => r.m.left),
					over: sum((r) => Math.max(0, -r.m.left)),
					need: sum((r) => r.target?.need ?? 0),
					count: mine.length,
				},
				envelopes: mine.map((r) => rowDto(r, p, money)),
			};
		})
		.filter((g) => g.id !== null || g.envelopes.length > 0);
}

/**
 * Limits (SPEC §6.1): envelopes with a limit or money this month. A limit is
 * what the envelope got this month (carried in plus assigned, which plan
 * funding makes the target), so Left = limit - spent. Ahead of pace when a
 * larger share of the limits is spent than of the month has passed.
 */
function limitTotals(rows: Row[], p: MonthViewInput): LimitTotals | null {
	if (p.book.style !== "LIMITS") return null;
	const limited = rows.filter(
		(r) => r.env.target !== null || r.m.assigned !== 0 || r.m.carryIn !== 0,
	);
	const limit = limited.reduce((t, r) => t + r.m.carryIn + r.m.assigned, 0);
	const spent = -limited.reduce((t, r) => t + (r.m.activity - r.m.wealth), 0);
	const left = limited.reduce((t, r) => t + r.m.left, 0);
	const range = monthRange(p.month, p.book.periods);
	const days = daysBetween(range.from, range.to) + 1;
	const passed = Math.min(
		days,
		Math.max(0, daysBetween(range.from, p.today) + 1),
	);
	return {
		limit,
		spent,
		left,
		aheadOfPace: limit > 0 && spent * days > limit * passed,
	};
}

function weekTotals(rows: Row[]) {
	const weekly = rows.filter((r) => r.week);
	if (weekly.length === 0) return null;
	const first = weekly[0]?.week as NonNullable<Row["week"]>;
	const left = weekly.reduce((t, r) => t + (r.week?.leftThisWeek ?? 0), 0);
	return {
		left,
		perDay: perDay(left, first.daysLeftInWeek),
		daysLeftInWeek: first.daysLeftInWeek,
		resetsOn: first.resetsOn,
	};
}

/** Left to spend for the month (D-owner-2026-10-22d) with the recurring part of Spending for the pace line (D60). */
function leftToSpendFor(
	rows: Row[],
	p: MonthViewInput,
	toAssign: Minor,
): LeftToSpend {
	const role = new Map(p.book.groups.map((g) => [g.id, g.role]));
	const roleOf = (r: Row) =>
		r.env.groupId ? (role.get(r.env.groupId) ?? null) : null;
	const range = monthRange(p.month, p.book.periods);
	return leftToSpend({
		envelopes: rows.map((r) => ({
			groupRole: roleOf(r),
			carryIn: r.m.carryIn,
			assigned: r.m.assigned,
			activity: r.m.activity,
			left: r.m.left,
			wealth: r.m.wealth,
		})),
		toAssign,
		billNeeds: rows
			.filter((r) => roleOf(r) === "BILLS")
			.map((r) => r.target?.need ?? 0),
		month: range,
		today: p.today,
		recurringSpent: -rows
			.filter((r) => roleOf(r) === "SPENDING")
			.reduce((t, r) => t + r.m.recurring, 0),
	});
}

export interface MonthView {
	dto: GetMonthOutput;
	verdict: Verdict;
	leftToSpend: LeftToSpend;
}

/** The getMonth DTO for `p.month` (current month c from the engine, m <= c + 1). */
export function buildMonthView(p: MonthViewInput): MonthView {
	const c = p.state.currentMonth;
	if (p.month > addMonths(c, 1) || p.month < p.book.startMonth)
		throw new RangeError(`month ${p.month} is outside the budget`);
	const money = (minor: Minor): Money => ({ minor, currency: p.book.currency });
	const range = monthRange(p.month, p.book.periods);
	const rows = rowsFor(p, c);
	const terms = p.state.toAssign(p.month);
	const lts = leftToSpendFor(rows, p, terms.total);
	const v = verdict({
		style: p.book.style,
		month: p.month,
		toAssign: terms.total,
		leftToSpend: lts,
		overspent: rows
			.filter((r) => r.m.left < 0)
			.map((r) => ({ id: r.env.id, over: -r.m.left })),
		week: weekTotals(rows),
		limits: limitTotals(rows, p),
	});
	const incomplete =
		p.missingRates.length > 0 ||
		p.book.envelopes.some((e) => e.targetIncomplete);
	return {
		verdict: v,
		leftToSpend: lts,
		dto: {
			book: {
				id: p.book.id,
				style: p.book.style,
				fundingSource: p.book.fundingSource,
				currency: p.book.currency,
				startMonth: p.book.startMonth,
				weekStartDay: p.book.weekStartDay,
				defaultEnvelopeId: p.book.defaultEnvelopeId,
				paused: p.book.paused ?? false,
			},
			month: {
				key: p.month,
				...range,
				state: p.month < c ? "CLOSED" : p.month === c ? "OPEN" : "NEXT",
			},
			today: p.today,
			toAssign: {
				amount: money(terms.total),
				poolName: poolNameFor(p.book.style),
				terms: {
					moneyIn: money(terms.moneyIn),
					assigned: money(terms.assigned),
					assignedAhead: money(terms.assignedAhead),
					overspendTaken: money(terms.overspendTaken),
					returned: money(terms.returned),
					splitsNet: money(terms.splitsNet),
				},
			},
			groups: groupsDto(rows, p, money),
			leftToSpend: leftToSpendDto(lts, money),
			verdict: verdictDto(v, money, incomplete),
			owed: p.owed ?? {
				held: money(0),
				pending: money(0),
				people: 0,
				aging: 0,
			},
			shares: sharesOf(p, rows),
			incomplete,
			missingRates: p.missingRates.map(({ currency, rateType, date }) => ({
				currency,
				rateType,
				date,
			})),
		},
	};
}
