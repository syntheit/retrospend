import type {
	SyncBookPeriodDto,
	SyncBudgetBookDto,
	SyncBudgetMovementDto,
	SyncEnvelopeCategoryDto,
	SyncEnvelopeChangeDto,
	SyncEnvelopeDto,
	SyncEnvelopeGroupDto,
	SyncIncomeRuleDto,
	SyncIncomeRuleRunDto,
	SyncMonthCloseDto,
	SyncPayoffPlanDto,
	SyncQuery,
	SyncWealthTransferDto,
} from "@retrospend/api-contract";
import type { SyncRow } from "~/server/services/sync/entities";
import type { Caller } from "./caller";
import { decimal, decimalOrNull, instant, pageOf } from "./sync";

/**
 * v1 adapters for the personal budget book's /sync/{entity} routes (P14c),
 * field for field like sync.ts: every mapper names each field, so a column
 * added to a table cannot reach a device until someone decides it may, and the
 * server's own columns (actors, undo state, derived caches, the legacy move's
 * bookkeeping) never do.
 */

const instantOrNull = (date: Date | null) => (date ? instant(date) : null);

export function toSyncBudgetBook(
	row: SyncRow<"budget_book">,
): SyncBudgetBookDto {
	return {
		id: row.id,
		name: row.name,
		isPersonal: row.isPersonal,
		currency: row.currency,
		style: row.style,
		fundingSource: row.fundingSource,
		pausedAt: instantOrNull(row.pausedAt),
		weekStartDay: row.weekStartDay,
		monthStartDay: row.monthStartDay,
		timeZone: row.timeZone,
		timeZoneConfirmed: row.timeZoneConfirmed,
		startDate: instant(row.startDate),
		startMonth: row.startMonth,
		defaultEnvelopeId: row.defaultEnvelopeId,
		startingBalanceExpenseId: row.startingBalanceExpenseId,
		startingMoneyConfirmedAt: instantOrNull(row.startingMoneyConfirmedAt),
		welcomeBackFrom: instantOrNull(row.welcomeBackFrom),
		reconciledAt: instantOrNull(row.reconciledAt),
		planFundFrom: row.planFundFrom,
		payFrequency: row.payFrequency,
		payAnchor: instantOrNull(row.payAnchor),
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
	};
}

export function toSyncEnvelopeGroup(
	row: SyncRow<"envelope_group">,
): SyncEnvelopeGroupDto {
	return {
		id: row.id,
		bookId: row.bookId,
		name: row.name,
		sortOrder: row.sortOrder,
		role: row.role,
		targetKind: row.targetKind,
		targetValue: decimalOrNull(row.targetValue),
		mainEnvelopeId: row.mainEnvelopeId,
		archivedAt: instantOrNull(row.archivedAt),
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
	};
}

export function toSyncEnvelope(row: SyncRow<"envelope">): SyncEnvelopeDto {
	return {
		id: row.id,
		bookId: row.bookId,
		groupId: row.groupId,
		name: row.name,
		icon: row.icon,
		color: row.color,
		kind: row.kind,
		sortOrder: row.sortOrder,
		targetAmount: decimalOrNull(row.targetAmount),
		targetMode: row.targetMode,
		targetCadence: row.targetCadence,
		targetMonthlyAmount: decimalOrNull(row.targetMonthlyAmount),
		targetCurrency: row.targetCurrency,
		targetDueDate: instantOrNull(row.targetDueDate),
		targetRepeat: row.targetRepeat,
		targetStartMonth: row.targetStartMonth,
		targetTemplateId: row.targetTemplateId,
		targetLiabilityId: row.targetLiabilityId,
		leftoverRule: row.leftoverRule,
		leftoverSweepToId: row.leftoverSweepToId,
		wealthAccountId: row.wealthAccountId,
		wealthDedicated: row.wealthDedicated,
		archivedAt: instantOrNull(row.archivedAt),
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
	};
}

export function toSyncEnvelopeCategory(
	row: SyncRow<"envelope_category">,
): SyncEnvelopeCategoryDto {
	return {
		id: row.id,
		bookId: row.bookId,
		envelopeId: row.envelopeId,
		categoryId: row.categoryId,
		createdAt: instant(row.createdAt),
	};
}

export function toSyncBudgetMovement(
	row: SyncRow<"budget_movement">,
): SyncBudgetMovementDto {
	return {
		id: row.id,
		bookId: row.bookId,
		month: row.month,
		fromEnvelopeId: row.fromEnvelopeId,
		toEnvelopeId: row.toEnvelopeId,
		amount: decimal(row.amount),
		kind: row.kind,
		batchId: row.batchId,
		revertsId: row.revertsId,
		sourceExpenseId: row.sourceExpenseId,
		ruleId: row.ruleId,
		note: row.note,
		createdAt: instant(row.createdAt),
	};
}

export function toSyncBookPeriod(
	row: SyncRow<"book_period">,
): SyncBookPeriodDto {
	return {
		id: row.id,
		bookId: row.bookId,
		fromMonth: row.fromMonth,
		startDay: row.startDay,
		rateType: row.rateType,
		createdAt: instant(row.createdAt),
	};
}

export function toSyncMonthClose(
	row: SyncRow<"month_close">,
): SyncMonthCloseDto {
	return {
		id: row.id,
		bookId: row.bookId,
		month: row.month,
		mode: row.mode,
		closedAt: instant(row.closedAt),
		revision: row.revision,
		summary: row.summary,
		acknowledgedAt: instantOrNull(row.acknowledgedAt),
		ackRevision: row.ackRevision,
		recalc: row.recalc,
		lateEntries: row.lateEntries,
	};
}

export function toSyncIncomeRule(
	row: SyncRow<"income_rule">,
): SyncIncomeRuleDto {
	return {
		id: row.id,
		bookId: row.bookId,
		sortOrder: row.sortOrder,
		name: row.name,
		matchKind: row.matchKind,
		matchValue: row.matchValue,
		matchTitle: row.matchTitle,
		action: row.action,
		value: decimalOrNull(row.value),
		envelopeId: row.envelopeId,
		active: row.active,
		archivedAt: instantOrNull(row.archivedAt),
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
	};
}

export function toSyncIncomeRuleRun(
	row: SyncRow<"income_rule_run">,
): SyncIncomeRuleRunDto {
	return {
		expenseId: row.expenseId,
		bookId: row.bookId,
		batchId: row.batchId,
		skipped: row.skipped,
		record: row.record,
		fingerprint: row.fingerprint,
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
	};
}

export function toSyncPayoffPlan(
	row: SyncRow<"payoff_plan">,
): SyncPayoffPlanDto {
	return {
		id: row.id,
		bookId: row.bookId,
		strategy: row.strategy,
		extraMonthly: decimal(row.extraMonthly),
		customOrder: row.customOrder,
		envelopeId: row.envelopeId,
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
	};
}

export function toSyncWealthTransfer(
	row: SyncRow<"wealth_transfer">,
): SyncWealthTransferDto {
	return {
		id: row.id,
		bookId: row.bookId,
		direction: row.direction,
		envelopeId: row.envelopeId,
		transferId: row.transferId,
		sourceExpenseId: row.sourceExpenseId,
		assetAccountId: row.assetAccountId,
		countOnly: row.countOnly,
		date: instant(row.date),
		amount: decimal(row.amount),
		note: row.note,
		createdAt: instant(row.createdAt),
	};
}

export function toSyncEnvelopeChange(
	row: SyncRow<"envelope_change">,
): SyncEnvelopeChangeDto {
	return {
		id: row.id,
		bookId: row.bookId,
		kind: row.kind,
		envelopeId: row.envelopeId,
		previousName: row.previousName,
		before: row.before,
		createdAt: instant(row.createdAt),
		undoneAt: instantOrNull(row.undoneAt),
	};
}

export const syncBudgetBooks = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "budget_book", query, toSyncBudgetBook);

export const syncEnvelopeGroups = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "envelope_group", query, toSyncEnvelopeGroup);

export const syncEnvelopes = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "envelope", query, toSyncEnvelope);

export const syncEnvelopeCategories = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "envelope_category", query, toSyncEnvelopeCategory);

export const syncBudgetMovements = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "budget_movement", query, toSyncBudgetMovement);

export const syncBookPeriods = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "book_period", query, toSyncBookPeriod);

export const syncMonthCloses = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "month_close", query, toSyncMonthClose);

export const syncIncomeRules = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "income_rule", query, toSyncIncomeRule);

export const syncIncomeRuleRuns = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "income_rule_run", query, toSyncIncomeRuleRun);

export const syncPayoffPlans = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "payoff_plan", query, toSyncPayoffPlan);

export const syncWealthTransfers = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "wealth_transfer", query, toSyncWealthTransfer);

export const syncEnvelopeChanges = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "envelope_change", query, toSyncEnvelopeChange);
