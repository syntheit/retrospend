/**
 * Budget items (SPEC §5.14) from the envelope engine's month view: one
 * item per type, amounts aggregated. Pure: the caller reads the view once
 * (monthViewIn, memoized per transaction) and passes the facts in.
 *
 * A month with a missing rate yields only the missing-rate item (and the
 * starting money prompt): every other amount would include the rateless
 * rows, and a guessed number never reaches the list (R14).
 */
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { item } from "./catalog";
import type { IsoDate, NeedsYouItem } from "./types";

export interface BudgetFacts {
	readonly dto: GetMonthOutput;
	/** Switched to Just track: no budget items (SPEC §4.4). */
	readonly paused: boolean;
	/** Setup left the starting money unanswered (SPEC §5.14 Starting money). */
	readonly startingMoneyUnconfirmed: boolean;
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

function poolItems(dto: GetMonthOutput): NeedsYouItem[] {
	const pool = dto.toAssign.amount;
	const entity = { kind: "book" as const, id: dto.book.id };
	if (pool.minor > 0) return [item("budget.giveJob", { entity, amount: pool })];
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

export function budgetItems(facts: BudgetFacts): NeedsYouItem[] {
	if (facts.paused) return [];
	const { dto } = facts;
	const starting = facts.startingMoneyUnconfirmed
		? [
				item("budget.startingMoney", {
					entity: { kind: "book", id: dto.book.id },
				}),
			]
		: [];
	if (dto.incomplete || dto.missingRates.length > 0)
		return [...missingRateItem(dto), ...starting];
	return [
		...poolItems(dto),
		...overspentItem(dto),
		...billDueItem(dto),
		...starting,
	];
}
