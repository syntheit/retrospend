/**
 * The device's rows as the budget loader's types: the personal
 * book with its periods, groups, envelopes and category links, the closes
 * without a checkpoint, and the expense and account rows the budget reads,
 * each turned from the port's text decimals and plain strings into the domain's
 * Decimals and enums. Plain reads and conversions: nothing here values, rounds
 * or filters (budget-source.ts applies the domain's row filters).
 *
 * A value the app does not know (a newer server's enum) throws
 * BudgetUnreadable; the reads answer unavailable for it, never a guess.
 */
import type {
	BookEnvelopeRow,
	BookGroupRow,
	BookRowCore,
	CloseRowCore,
} from "@retrospend/domain/envelope/book-source";
import type { BudgetRowFields } from "@retrospend/domain/envelope/budget-rows";
import type { LeftoverRule } from "@retrospend/domain/envelope/engine";
import type { ExpenseRow as BudgetExpense } from "@retrospend/domain/envelope/entries";
import type { Frequency } from "@retrospend/domain/envelope/target-input";
import type { GroupTargetKind } from "@retrospend/domain/envelope/types";
import type { BudgetStyle } from "@retrospend/domain/envelope/verdict";
import { dec } from "@retrospend/domain/precise-decimal";
import { rowsIn } from "./pass-reads";
import type { Reader, TableRows } from "./port";

type Pass = Parameters<typeof rowsIn>[1];

/** Something the device cannot read the budget from: a value it does not know, or a block it does not hold. */
export class BudgetUnreadable extends Error {
	override readonly name = "BudgetUnreadable";
}

function oneOf<T extends string>(
	value: string,
	allowed: readonly T[],
	what: string,
): T {
	if ((allowed as readonly string[]).includes(value)) return value as T;
	throw new BudgetUnreadable(`${what} is not a value this app knows`);
}

const STYLES = [
	"LIMITS",
	"FLEX",
	"EVERY_DOLLAR",
	"SAVE_FIRST",
	"FIFTY_THIRTY_TWENTY",
	"WEEKLY",
	"DEBT_PAYOFF",
] as const satisfies readonly BudgetStyle[];
const FUNDING = ["INCOME", "TARGETS"] as const;
const ROLES = ["BILLS", "SPENDING", "SAVINGS"] as const;
const GROUP_TARGETS = [
	"NONE",
	"AMOUNT",
	"PERCENT_OF_INCOME",
] as const satisfies readonly GroupTargetKind[];
const KINDS = ["MONTHLY", "BILL", "SAVINGS", "NONE"] as const;
const MODES = ["REFILL", "SET_ASIDE"] as const;
const CADENCES = ["MONTH", "WEEK"] as const;
const FREQUENCIES = [
	"WEEKLY",
	"BIWEEKLY",
	"MONTHLY",
	"QUARTERLY",
	"YEARLY",
] as const satisfies readonly Frequency[];
const RULES = [
	"CARRY",
	"RETURN",
	"SWEEP",
] as const satisfies readonly LeftoverRule[];
const DIRECTIONS = ["IN", "OUT"] as const;
const ENTRY_KINDS = [
	"STANDARD",
	"STARTING_BALANCE",
	"ADJUSTMENT",
	"NOT_SPENDING",
] as const;

export const leftoverRuleOf = (value: string): LeftoverRule =>
	oneOf(value, RULES, "A leftover rule");

/** The personal book of the store (a person has one), or undefined. */
export const bookOf = (db: Reader, pass: Pass) =>
	rowsIn(db, pass, "budgetBooks")[0];

function groupRow(g: TableRows["envelopeGroups"]): BookGroupRow {
	return {
		id: g.id,
		name: g.name,
		role: g.role === null ? null : oneOf(g.role, ROLES, "A group role"),
		sortOrder: g.sortOrder,
		targetKind: oneOf(g.targetKind, GROUP_TARGETS, "A group target"),
		targetValue: g.targetValue === null ? null : dec(g.targetValue),
		mainEnvelopeId: g.mainEnvelopeId,
	};
}

function envelopeRow(
	e: TableRows["envelopes"],
	categoryIds: readonly string[],
): BookEnvelopeRow {
	return {
		id: e.id,
		name: e.name,
		icon: e.icon,
		color: e.color,
		groupId: e.groupId,
		sortOrder: e.sortOrder,
		archivedAt: e.archivedAt,
		targetStartMonth: e.targetStartMonth,
		wealthDedicated: e.wealthDedicated,
		wealthAccountId: e.wealthAccountId,
		leftoverRule: leftoverRuleOf(e.leftoverRule),
		leftoverSweepToId: e.leftoverSweepToId,
		categories: categoryIds.map((categoryId) => ({ categoryId })),
		kind: oneOf(e.kind, KINDS, "An envelope kind"),
		targetAmount: e.targetAmount === null ? null : dec(e.targetAmount),
		targetMode: oneOf(e.targetMode, MODES, "A target mode"),
		targetCadence: oneOf(e.targetCadence, CADENCES, "A target cadence"),
		targetMonthlyAmount:
			e.targetMonthlyAmount === null ? null : dec(e.targetMonthlyAmount),
		targetCurrency: e.targetCurrency,
		targetDueDate: e.targetDueDate,
		targetRepeat:
			e.targetRepeat === null
				? null
				: oneOf(e.targetRepeat, FREQUENCIES, "A target repeat"),
		targetTemplateId: e.targetTemplateId,
		targetLiabilityId: e.targetLiabilityId,
	};
}

/**
 * The personal book as the loader reads it, or null when the store holds
 * none. Periods come in effect order, live groups only (the server's include
 * leaves archived ones out), every envelope with the categories that feed it.
 */
export function bookRowOf(
	db: Reader,
	pass: Pass,
	userId: string,
): BookRowCore | null {
	const book = bookOf(db, pass);
	if (!book) return null;
	const mine = <T extends { bookId: string }>(rows: readonly T[]) =>
		rows.filter((r) => r.bookId === book.id);
	const links = new Map<string, string[]>();
	for (const l of mine(rowsIn(db, pass, "envelopeCategories"))) {
		const list = links.get(l.envelopeId) ?? [];
		list.push(l.categoryId);
		links.set(l.envelopeId, list);
	}
	return {
		id: book.id,
		createdById: userId,
		currency: book.currency,
		style: oneOf(book.style, STYLES, "A budget style"),
		fundingSource: oneOf(book.fundingSource, FUNDING, "A funding source"),
		pausedAt: book.pausedAt,
		weekStartDay: book.weekStartDay,
		timeZone: book.timeZone,
		startDate: book.startDate,
		startMonth: book.startMonth,
		defaultEnvelopeId: book.defaultEnvelopeId,
		startingBalanceExpenseId: book.startingBalanceExpenseId,
		periods: [...mine(rowsIn(db, pass, "bookPeriods"))]
			.sort((a, b) => a.fromMonth - b.fromMonth)
			.map((p) => ({
				fromMonth: p.fromMonth,
				startDay: p.startDay,
				rateType: p.rateType,
			})),
		groups: mine(rowsIn(db, pass, "envelopeGroups"))
			.filter((g) => g.archivedAt === null)
			.map(groupRow),
		envelopes: mine(rowsIn(db, pass, "envelopes")).map((e) =>
			envelopeRow(e, links.get(e.id) ?? []),
		),
	};
}

/** The book's closes, oldest first. A device keeps no checkpoint: every pass runs from the book's start. */
export function closeRowsOf(
	db: Reader,
	pass: Pass,
	bookId: string,
): CloseRowCore[] {
	return rowsIn(db, pass, "monthCloses")
		.filter((c) => c.bookId === bookId)
		.sort((a, b) => a.month - b.month)
		.map((c) => ({
			month: c.month,
			summary: {
				envelopes: c.summary.envelopes.map((e) => ({
					id: e.id,
					rule: leftoverRuleOf(e.rule),
					sweepToId: e.sweepToId,
				})),
				...(c.summary.links === undefined ? {} : { links: c.summary.links }),
			},
			checkpoint: null,
		}));
}

type StoredExpense = TableRows["expenses"];

/**
 * The columns the budget row filters read. The columns a device's own rows may
 * lack (a row it created before the sync set them) take the column defaults:
 * not an amortized child, no parent, INSTALLMENTS, not kept in Wealth.
 */
export function filterFieldsOf(e: StoredExpense): BudgetRowFields {
	return {
		status: e.status,
		direction: e.direction,
		entryKind: e.entryKind,
		inType: e.inType,
		keepInWealth: e.keepInWealth ?? false,
		isAmortizedParent: e.isAmortizedParent,
		isAmortizedChild: e.isAmortizedChild ?? false,
		parentId: e.parentId ?? null,
		amortizeMode: e.amortizeMode ?? "INSTALLMENTS",
		categoryKind: e.categoryKind,
		date: e.date,
	};
}

/** An expense as the loader values it: exact decimals, the columns the valuer and the entries read. */
export function budgetExpenseOf(e: StoredExpense): BudgetExpense {
	return {
		id: e.id,
		amount: dec(e.amount),
		currency: e.currency,
		amountInUSD: dec(e.amountInUSD),
		homeCurrency: e.homeCurrency,
		homeAmount: e.homeAmount === null ? null : dec(e.homeAmount),
		date: e.date,
		categoryId: e.categoryId ?? null,
		recurringTemplateId: e.recurringTemplateId ?? null,
		direction: oneOf(e.direction, DIRECTIONS, "A direction"),
		entryKind: oneOf(e.entryKind, ENTRY_KINDS, "An entry kind"),
		budgetEnvelopeId: e.budgetEnvelopeId ?? null,
	};
}
