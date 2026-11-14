/**
 * The budget book family in the sync apply layer (E2EE P13b): the wire shapes of
 * the book's tables, the transfers a bill reads and the budget block of
 * GET /sync/shares, and the port rows they make. Shapes are structural, as in
 * sync-apply.ts: a pg test assigns the contract's DTOs to them.
 */
import type { SplitBlock } from "@retrospend/domain/envelope/split-block";
import type { CloseSummary } from "./book-rows";
import { BUDGET_SNAPSHOT_ID, InvalidInputError, type TableRows } from "./port";
import {
	decimal,
	decimalOrNull,
	instant,
	instantOrNull,
	monthKey,
	monthKeyOrNull,
} from "./sync-values";

export interface WireBudgetBook {
	readonly id: string;
	readonly currency: string;
	readonly style: string;
	readonly fundingSource: string;
	readonly pausedAt: string | null;
	readonly weekStartDay: number;
	readonly timeZone: string;
	readonly startDate: string;
	readonly startMonth: number;
	readonly defaultEnvelopeId: string | null;
	readonly startingBalanceExpenseId: string | null;
}

export interface WireEnvelopeGroup {
	readonly id: string;
	readonly bookId: string;
	readonly name: string;
	readonly sortOrder: number;
	readonly role: string | null;
	readonly targetKind: string;
	readonly targetValue: string | null;
	readonly mainEnvelopeId: string | null;
	readonly archivedAt: string | null;
}

export interface WireEnvelope {
	readonly id: string;
	readonly bookId: string;
	readonly groupId: string | null;
	readonly name: string;
	readonly icon: string | null;
	readonly color: string | null;
	readonly kind: string;
	readonly sortOrder: number;
	readonly targetAmount: string | null;
	readonly targetMode: string;
	readonly targetCadence: string;
	readonly targetMonthlyAmount: string | null;
	readonly targetCurrency: string | null;
	readonly targetDueDate: string | null;
	readonly targetRepeat: string | null;
	readonly targetStartMonth: number | null;
	readonly targetTemplateId: string | null;
	readonly targetLiabilityId: string | null;
	readonly leftoverRule: string;
	readonly leftoverSweepToId: string | null;
	readonly wealthAccountId: string | null;
	readonly wealthDedicated: boolean;
	readonly archivedAt: string | null;
}

export interface WireEnvelopeCategory {
	readonly id: string;
	readonly bookId: string;
	readonly envelopeId: string;
	readonly categoryId: string;
}

export interface WireBudgetMovement {
	readonly id: string;
	readonly bookId: string;
	readonly month: number;
	readonly fromEnvelopeId: string | null;
	readonly toEnvelopeId: string | null;
	readonly amount: string;
}

export interface WireBookPeriod {
	readonly id: string;
	readonly bookId: string;
	readonly fromMonth: number;
	readonly startDay: number;
	readonly rateType: string;
}

export interface WireMonthClose {
	readonly id: string;
	readonly bookId: string;
	readonly month: number;
	/** A JSON column: checked and narrowed when applied. */
	readonly summary: unknown;
}

export interface WireWealthTransfer {
	readonly id: string;
	readonly bookId: string;
	readonly direction: string;
	readonly envelopeId: string | null;
	readonly date: string;
	readonly amount: string;
}

export interface WirePayoffPlan {
	readonly id: string;
	readonly bookId: string;
	readonly strategy: string;
	readonly extraMonthly: string;
	/** A JSON column: checked and narrowed when applied. */
	readonly customOrder: unknown;
	readonly envelopeId: string | null;
}

export interface WireTransfer {
	readonly id: string;
	readonly date: string;
	readonly toAccountId: string | null;
	readonly toAmount: string;
	readonly toCurrency: string;
	readonly feeExpenseId: string | null;
}

export interface WireBudgetBlock {
	readonly bookId: string;
	readonly valuationKey: string;
	readonly asOf: string;
	readonly frozen: readonly {
		readonly key: string;
		readonly minor: number;
		readonly approximate: boolean;
	}[];
	readonly splits: SplitBlock;
}

/** The wire rows of the book family, by the table they fill. */
export interface BookWireOf {
	budgetBooks: WireBudgetBook;
	envelopeGroups: WireEnvelopeGroup;
	envelopes: WireEnvelope;
	envelopeCategories: WireEnvelopeCategory;
	budgetMovements: WireBudgetMovement;
	bookPeriods: WireBookPeriod;
	monthCloses: WireMonthClose;
	wealthTransfers: WireWealthTransfer;
	payoffPlans: WirePayoffPlan;
	transfers: WireTransfer;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The part of a close's summary the loader reads: each envelope's leftover
 * rule and sweep target, and the category links when it has them. Anything
 * else in the column stays on the wire.
 */
function closeSummary(value: unknown, what: string): CloseSummary {
	if (!isRecord(value) || !Array.isArray(value.envelopes))
		throw new InvalidInputError(`${what} summary has no envelopes`);
	const envelopes = value.envelopes.map((e: unknown) => {
		if (
			!isRecord(e) ||
			typeof e.id !== "string" ||
			typeof e.rule !== "string" ||
			!(e.sweepToId === null || typeof e.sweepToId === "string")
		)
			throw new InvalidInputError(`${what} summary has a bad envelope`);
		return { id: e.id, rule: e.rule, sweepToId: e.sweepToId };
	});
	const { links } = value;
	if (links === undefined) return { envelopes };
	if (
		!isRecord(links) ||
		!Object.values(links).every((l) => typeof l === "string")
	)
		throw new InvalidInputError(`${what} summary has bad links`);
	return { envelopes, links: links as Record<string, string> };
}

function accountIds(value: unknown, what: string): string[] {
	if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
		throw new InvalidInputError(`${what} is not a list of ids`);
	return [...value] as string[];
}

export const BOOK_ROWS: {
	[E in keyof BookWireOf]: (wire: BookWireOf[E]) => TableRows[E];
} = {
	budgetBooks: (w) => ({
		id: w.id,
		currency: w.currency,
		style: w.style,
		fundingSource: w.fundingSource,
		pausedAt: instantOrNull(w.pausedAt, `Book ${w.id} pausedAt`),
		weekStartDay: w.weekStartDay,
		timeZone: w.timeZone,
		startDate: instant(w.startDate, `Book ${w.id} startDate`),
		startMonth: monthKey(w.startMonth, `Book ${w.id} startMonth`),
		defaultEnvelopeId: w.defaultEnvelopeId,
		startingBalanceExpenseId: w.startingBalanceExpenseId,
	}),
	envelopeGroups: (w) => ({
		id: w.id,
		bookId: w.bookId,
		name: w.name,
		sortOrder: w.sortOrder,
		role: w.role,
		targetKind: w.targetKind,
		targetValue: decimalOrNull(w.targetValue, `Group ${w.id} targetValue`),
		mainEnvelopeId: w.mainEnvelopeId,
		archivedAt: instantOrNull(w.archivedAt, `Group ${w.id} archivedAt`),
	}),
	envelopes: (w) => ({
		id: w.id,
		bookId: w.bookId,
		groupId: w.groupId,
		name: w.name,
		icon: w.icon,
		color: w.color,
		kind: w.kind,
		sortOrder: w.sortOrder,
		targetAmount: decimalOrNull(
			w.targetAmount,
			`Envelope ${w.id} targetAmount`,
		),
		targetMode: w.targetMode,
		targetCadence: w.targetCadence,
		targetMonthlyAmount: decimalOrNull(
			w.targetMonthlyAmount,
			`Envelope ${w.id} targetMonthlyAmount`,
		),
		targetCurrency: w.targetCurrency,
		targetDueDate: instantOrNull(
			w.targetDueDate,
			`Envelope ${w.id} targetDueDate`,
		),
		targetRepeat: w.targetRepeat,
		targetStartMonth: monthKeyOrNull(
			w.targetStartMonth,
			`Envelope ${w.id} targetStartMonth`,
		),
		targetTemplateId: w.targetTemplateId,
		targetLiabilityId: w.targetLiabilityId,
		leftoverRule: w.leftoverRule,
		leftoverSweepToId: w.leftoverSweepToId,
		wealthAccountId: w.wealthAccountId,
		wealthDedicated: w.wealthDedicated,
		archivedAt: instantOrNull(w.archivedAt, `Envelope ${w.id} archivedAt`),
	}),
	envelopeCategories: (w) => ({
		id: w.id,
		bookId: w.bookId,
		envelopeId: w.envelopeId,
		categoryId: w.categoryId,
	}),
	budgetMovements: (w) => ({
		id: w.id,
		bookId: w.bookId,
		month: monthKey(w.month, `Movement ${w.id} month`),
		fromEnvelopeId: w.fromEnvelopeId,
		toEnvelopeId: w.toEnvelopeId,
		amount: decimal(w.amount, `Movement ${w.id} amount`),
	}),
	bookPeriods: (w) => ({
		id: w.id,
		bookId: w.bookId,
		fromMonth: monthKey(w.fromMonth, `Period ${w.id} fromMonth`),
		startDay: w.startDay,
		rateType: w.rateType,
	}),
	monthCloses: (w) => ({
		id: w.id,
		bookId: w.bookId,
		month: monthKey(w.month, `Close ${w.id} month`),
		summary: closeSummary(w.summary, `Close ${w.id}`),
	}),
	wealthTransfers: (w) => ({
		id: w.id,
		bookId: w.bookId,
		direction: w.direction,
		envelopeId: w.envelopeId,
		date: instant(w.date, `Wealth transfer ${w.id} date`),
		amount: decimal(w.amount, `Wealth transfer ${w.id} amount`),
	}),
	payoffPlans: (w) => ({
		id: w.id,
		bookId: w.bookId,
		strategy: w.strategy,
		extraMonthly: decimal(w.extraMonthly, `Payoff plan ${w.id} extraMonthly`),
		customOrder: accountIds(w.customOrder, `Payoff plan ${w.id} customOrder`),
		envelopeId: w.envelopeId,
	}),
	transfers: (w) => ({
		id: w.id,
		date: instant(w.date, `Transfer ${w.id} date`),
		toAccountId: w.toAccountId,
		toAmount: decimal(w.toAmount, `Transfer ${w.id} toAmount`),
		toCurrency: w.toCurrency,
		feeExpenseId: w.feeExpenseId,
	}),
};

/**
 * The snapshot row of a budget block, or undefined for the unavailable shape.
 * Only what a store needs to be sound is checked: the frozen values are a map
 * on a device, so a key may not repeat and a value is whole minor units. The
 * block's own figures are the server's and are never checked here.
 */
export function budgetSnapshotOf(
	budget: WireBudgetBlock | { readonly unavailable: true },
): TableRows["budgetSnapshot"] | undefined {
	if ("unavailable" in budget) return undefined;
	if (new Set(budget.frozen.map((f) => f.key)).size !== budget.frozen.length)
		throw new InvalidInputError("The budget block repeats a frozen key");
	for (const f of budget.frozen)
		if (!Number.isSafeInteger(f.minor))
			throw new InvalidInputError("A frozen value is not whole minor units");
	return {
		id: BUDGET_SNAPSHOT_ID,
		bookId: budget.bookId,
		valuationKey: budget.valuationKey,
		asOf: budget.asOf,
		frozen: budget.frozen.map((f) => ({
			key: f.key,
			minor: f.minor,
			approximate: f.approximate,
		})),
		splits: budget.splits,
	};
}
