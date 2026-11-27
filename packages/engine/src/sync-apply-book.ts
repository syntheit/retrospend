/**
 * The budget book family in the sync apply layer: the wire shapes of
 * the book's tables, the transfers a bill reads and the budget block of
 * GET /sync/shares, and the port rows they make. The wire shapes are the contract's
 * DTOs, so there is one definition of them; the budget block is also parsed
 * with the contract's schema before it is kept.
 */
import {
	type SyncBookPeriodDto,
	type SyncBudgetBlockDto,
	type SyncBudgetBookDto,
	type SyncBudgetMovementDto,
	type SyncEnvelopeCategoryDto,
	type SyncEnvelopeDto,
	type SyncEnvelopeGroupDto,
	type SyncMonthCloseDto,
	type SyncPayoffPlanDto,
	type SyncTransferDto,
	type SyncWealthTransferDto,
	syncBudgetBlockSchema,
} from "@retrospend/api-contract/sync";
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

export type WireBudgetBook = SyncBudgetBookDto;
export type WireEnvelopeGroup = SyncEnvelopeGroupDto;
export type WireEnvelope = SyncEnvelopeDto;
export type WireEnvelopeCategory = SyncEnvelopeCategoryDto;
export type WireBudgetMovement = SyncBudgetMovementDto;
export type WireBookPeriod = SyncBookPeriodDto;
export type WireMonthClose = SyncMonthCloseDto;
export type WireWealthTransfer = SyncWealthTransferDto;
export type WirePayoffPlan = SyncPayoffPlanDto;
export type WireTransfer = SyncTransferDto;
export type WireBudgetBlock = SyncBudgetBlockDto;

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
		transferId: w.transferId,
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
		kind: w.kind,
		date: instant(w.date, `Transfer ${w.id} date`),
		fromAccountId: w.fromAccountId,
		fromAmount: decimal(w.fromAmount, `Transfer ${w.id} fromAmount`),
		toAccountId: w.toAccountId,
		toAmount: decimal(w.toAmount, `Transfer ${w.id} toAmount`),
		toCurrency: w.toCurrency,
		feeExpenseId: w.feeExpenseId,
		countedFromUnits: decimal(
			w.countedFromUnits,
			`Transfer ${w.id} countedFromUnits`,
		),
		countedToUnits: decimal(
			w.countedToUnits,
			`Transfer ${w.id} countedToUnits`,
		),
		note: w.note,
	}),
};

/**
 * The snapshot row of a budget block, or undefined for the unavailable shape.
 * The whole block is parsed first with the contract's schema, so a body that
 * is corrupt or from a server this device does not understand never reaches a
 * store: types, ranges and dates, never whether the server's figures are
 * right. The error names the path and never a value.
 */
export function budgetSnapshotOf(
	budget: WireBudgetBlock | { readonly unavailable: true },
): TableRows["budgetSnapshot"] | undefined {
	if ((budget as { unavailable?: unknown }).unavailable === true)
		return undefined;
	const parsed = syncBudgetBlockSchema.safeParse(budget);
	if (!parsed.success) {
		const path = parsed.error.issues[0]?.path.join(".") || "block";
		throw new InvalidInputError(`The budget block's ${path} is not valid`);
	}
	const block = parsed.data;
	return {
		id: BUDGET_SNAPSHOT_ID,
		bookId: block.bookId,
		valuationKey: block.valuationKey,
		asOf: block.asOf,
		frozen: block.frozen.map((f) => ({
			key: f.key,
			minor: f.minor,
			approximate: f.approximate,
		})),
		splits: block.splits,
	};
}
