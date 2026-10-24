/**
 * Budget items (SPEC §5.14) from the envelope engine's month view: one
 * item per type, amounts aggregated. Pure: the caller reads the view once
 * (monthViewIn, memoized per transaction) and passes the facts in.
 *
 * A month with a missing rate yields only the missing-rate item (and the
 * starting money prompt and the month summary, which has no amount): every
 * other amount would include the rateless rows, and a guessed number never
 * reaches the list (R14). A Limits book hides To assign, so it has no pool
 * or starting money items (SPEC §5.6).
 */
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { item } from "./catalog";
import type { IsoDate, NeedsYouItem, NeedsYouSource } from "./types";

export interface BudgetFacts {
	readonly dto: GetMonthOutput;
	/** Switched to Just track: no budget items (SPEC §4.4). */
	readonly paused: boolean;
	/** Setup left the starting money unanswered (SPEC §5.14 Starting money). */
	readonly startingMoneyUnconfirmed: boolean;
	/** Money in the engine counted (valued in the book), with each row's title and day. */
	readonly moneyIn: readonly MoneyInFact[];
	/** Closed months waiting to be read, and the latest change after a late window. */
	readonly closes?: CloseFacts;
	/** Reconciled before, not yet this month (SPEC §5.11). */
	readonly reconcileDue?: boolean;
}

export interface CloseFacts {
	/** Summaries closed in the last 7 days and not acknowledged, oldest first. */
	readonly waiting: readonly { month: number; from: IsoDate }[];
	/** The newest change after a late window not acknowledged yet (C16). */
	readonly changed: {
		readonly earliestMonth: number;
		readonly earliestFrom: IsoDate;
		/** Book currency minor units, signed. */
		readonly toAssign: number;
		readonly envelopes: readonly { id: string; delta: number }[];
	} | null;
}

/** "Month summary": one item for every close waiting (SPEC §5.14). */
function summaryItem(dto: GetMonthOutput, c: CloseFacts): NeedsYouItem[] {
	const newest = c.waiting.at(-1);
	if (!newest) return [];
	return [
		item("budget.monthSummary", {
			entity: { kind: "book", id: dto.book.id },
			entityIds: c.waiting.map((w) => String(w.month)),
			count: c.waiting.length,
			date: newest.from,
		}),
	];
}

/** "Month changed after it closed": the change and its largest effect today (C16). */
function changedItem(dto: GetMonthOutput, c: CloseFacts): NeedsYouItem[] {
	const ch = c.changed;
	if (!ch) return [];
	const H = dto.book.currency;
	const biggest = [...ch.envelopes].sort(
		(a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.id < b.id ? -1 : 1),
	)[0];
	const names = new Map(envelopesOf(dto).map((e) => [e.id, e.name]));
	return [
		item("budget.monthChanged", {
			entity: biggest
				? { kind: "envelope", id: biggest.id }
				: { kind: "book", id: dto.book.id },
			entityIds: ch.envelopes.map((e) => e.id),
			amount: { minor: biggest?.delta ?? ch.toAssign, currency: H },
			count: ch.envelopes.length,
			date: ch.earliestFrom,
			title:
				ch.envelopes.length === 1 && biggest
					? (names.get(biggest.id) ?? null)
					: null,
		}),
	];
}

export interface MoneyInFact {
	readonly id: string;
	readonly source: "INCOME" | "STARTING_BALANCE" | "ADJUSTMENT";
	readonly title: string;
	readonly date: IsoDate;
	/** Book currency minor units, signed as the engine counts it. */
	readonly minor: number;
}

/**
 * Where today's unplanned money came from (kit `unplannedSources`, RC-2):
 * the newest money in first, each taking what is left of the pool, until
 * the pool is covered. Adjustments are corrections, not money that arrived.
 */
export function unplannedSources(
	moneyIn: readonly MoneyInFact[],
	pool: number,
	currency: string,
): NeedsYouSource[] {
	const out: NeedsYouSource[] = [];
	let left = pool;
	const newest = moneyIn
		.filter((m) => m.minor > 0 && m.source !== "ADJUSTMENT")
		.sort((a, b) =>
			a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1,
		);
	for (const m of newest) {
		if (left <= 0) break;
		const part = Math.min(m.minor, left);
		left -= part;
		out.push({
			entryId: m.id,
			kind: m.source as NeedsYouSource["kind"],
			title: m.title,
			date: m.date,
			amount: { minor: m.minor, currency },
			part: { minor: part, currency },
		});
	}
	return out;
}

/** A bill shows this many days before it is due (SPEC §5.14). */
export const BILL_DUE_DAYS = 7;

export function addDays(day: IsoDate, days: number): IsoDate {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const envelopesOf = (dto: GetMonthOutput) =>
	dto.groups.flatMap((g) => g.envelopes);

function missingRateItem(dto: GetMonthOutput): NeedsYouItem[] {
	const currencies = [
		...new Set(dto.missingRates.map((r) => r.currency)),
	].sort();
	if (currencies.length === 0) return [];
	return [
		item("budget.missingRate", {
			entity: { kind: "book", id: dto.book.id },
			currencies,
			attention: true,
		}),
	];
}

function poolItems(
	dto: GetMonthOutput,
	moneyIn: readonly MoneyInFact[],
): NeedsYouItem[] {
	const pool = dto.toAssign.amount;
	const entity = { kind: "book" as const, id: dto.book.id };
	if (pool.minor > 0) {
		const sources = unplannedSources(moneyIn, pool.minor, pool.currency);
		const newest = sources[0];
		return [
			item("budget.giveJob", {
				entity,
				amount: pool,
				sources,
				date: newest?.date ?? null,
				title: newest?.title ?? null,
			}),
		];
	}
	if (pool.minor < 0)
		return [
			item("budget.overAssigned", {
				entity,
				amount: { minor: -pool.minor, currency: pool.currency },
			}),
		];
	return [];
}

function overspentItem(dto: GetMonthOutput): NeedsYouItem[] {
	const over = dto.verdict.overEnvelopes;
	const first = over[0];
	if (!first) return [];
	const names = new Map(envelopesOf(dto).map((e) => [e.id, e.name]));
	return [
		item("budget.overspent", {
			entity: { kind: "envelope", id: first.id },
			entityIds: over.map((e) => e.id),
			amount: dto.verdict.over,
			count: over.length,
			title: over.length === 1 ? (names.get(first.id) ?? null) : null,
			attention: true,
		}),
	];
}

function billDueItem(dto: GetMonthOutput): NeedsYouItem[] {
	const until = addDays(dto.today, BILL_DUE_DAYS);
	const bills = envelopesOf(dto)
		.filter(
			(e) =>
				e.target?.kind === "BILL" &&
				!e.target.paid &&
				e.target.need.minor > 0 &&
				e.target.dueDate !== null &&
				e.target.dueDate <= until,
		)
		.sort((a, b) =>
			(a.target?.dueDate ?? "") < (b.target?.dueDate ?? "") ? -1 : 1,
		);
	const first = bills[0];
	if (!first?.target) return [];
	return [
		item("budget.billDue", {
			entity: { kind: "envelope", id: first.id },
			entityIds: bills.map((e) => e.id),
			amount: {
				minor: bills.reduce((t, e) => t + (e.target?.need.minor ?? 0), 0),
				currency: first.target.need.currency,
			},
			count: bills.length,
			date: first.target.dueDate,
			title: bills.length === 1 ? first.name : null,
			attention: (first.target.dueDate ?? until) < dto.today,
		}),
	];
}

/**
 * "Debt payment due" (SPEC §5.14): a bill that follows a liability's
 * minimum, due today or overdue, and not paid this cycle (the payment's
 * principal leaves that envelope, so the 90% rule marks it paid).
 */
function debtDueItem(dto: GetMonthOutput): NeedsYouItem[] {
	const due = envelopesOf(dto)
		.filter(
			(e) =>
				e.target?.kind === "BILL" &&
				e.target.liabilityId &&
				!e.target.paid &&
				e.target.dueDate !== null &&
				e.target.dueDate <= dto.today,
		)
		.sort((a, b) =>
			(a.target?.dueDate ?? "") < (b.target?.dueDate ?? "") ? -1 : 1,
		);
	const first = due[0];
	if (!first?.target?.amount) return [];
	return [
		item("budget.debtDue", {
			entity: { kind: "envelope", id: first.id },
			entityIds: due.map((e) => e.target?.liabilityId as string),
			amount: {
				minor: due.reduce((t, e) => t + (e.target?.amount?.minor ?? 0), 0),
				currency: first.target.amount.currency,
			},
			count: due.length,
			date: first.target.dueDate,
			title: due.length === 1 ? first.name : null,
			attention: true,
		}),
	];
}

export function budgetItems(facts: BudgetFacts): NeedsYouItem[] {
	if (facts.paused) return [];
	const { dto } = facts;
	// A Limits book hides To assign and asks for no money now (SPEC §5.6, §4.3).
	const limits = dto.book.fundingSource === "TARGETS";
	const starting =
		facts.startingMoneyUnconfirmed && !limits
			? [
					item("budget.startingMoney", {
						entity: { kind: "book", id: dto.book.id },
					}),
				]
			: [];
	const closes = facts.closes
		? [...summaryItem(dto, facts.closes), ...changedItem(dto, facts.closes)]
		: [];
	if (dto.incomplete || dto.missingRates.length > 0)
		return [
			...missingRateItem(dto),
			...starting,
			// The summary item carries no amount; a change does, so it waits.
			...(facts.closes ? summaryItem(dto, facts.closes) : []),
		];
	const reconcile = facts.reconcileDue
		? [item("budget.reconcile", { entity: { kind: "book", id: dto.book.id } })]
		: [];
	return [
		...(limits ? [] : poolItems(dto, facts.moneyIn)),
		...overspentItem(dto),
		...debtDueItem(dto),
		...billDueItem(dto),
		...starting,
		...closes,
		...reconcile,
	];
}
