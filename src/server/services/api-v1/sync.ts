import type {
	SyncAccountDto,
	SyncAccountHistoryDto,
	SyncAccountLegDto,
	SyncAccountRateTypeDto,
	SyncAccountSnapshotDto,
	SyncCategoryDto,
	SyncExpenseDto,
	SyncQuery,
	SyncRecurringTemplateDto,
	SyncTransferDto,
} from "@retrospend/api-contract";
import { readChanges, type SyncPage } from "~/server/services/sync/changes";
import type { SyncEntity, SyncRow } from "~/server/services/sync/entities";
import type { Caller } from "./caller";

/**
 * v1 adapters for /sync/{entity}: the delta reader's rows in their wire form,
 * field for field (the contract's sync group). Each mapper names every field,
 * so a column added to a table cannot reach a device until someone decides it
 * may, and a server-only column (category.nameIndex, userId) never does.
 * Decimals are written with toFixed(), which never uses an exponent.
 */

const instant = (date: Date) => date.toISOString();
const decimal = (value: { toFixed(): string }) => value.toFixed();

export function toSyncExpense(row: SyncRow<"expense">): SyncExpenseDto {
	return {
		id: row.id,
		title: row.title,
		amount: decimal(row.amount),
		currency: row.currency,
		date: instant(row.date),
		categoryId: row.categoryId,
		amountInUSD: decimal(row.amountInUSD),
		exchangeRate: decimal(row.exchangeRate),
		pricingSource: row.pricingSource,
		location: row.location,
		description: row.description,
		status: row.status,
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
		isAmortizedParent: row.isAmortizedParent,
		isAmortizedChild: row.isAmortizedChild,
		parentId: row.parentId,
		recurringTemplateId: row.recurringTemplateId,
		excludeFromAnalytics: row.excludeFromAnalytics,
		direction: row.direction,
		entryKind: row.entryKind,
		inType: row.inType,
		amortizeMode: row.amortizeMode,
		keepInWealth: row.keepInWealth,
		budgetEnvelopeId: row.budgetEnvelopeId,
		movedInAt: row.movedInAt ? instant(row.movedInAt) : null,
		planBatchId: row.planBatchId,
		rateType: row.rateType,
		homeCurrency: row.homeCurrency,
		homeRate: row.homeRate ? decimal(row.homeRate) : null,
		homeAmount: row.homeAmount ? decimal(row.homeAmount) : null,
		importFingerprint: row.importFingerprint,
	};
}

export function toSyncCategory(row: SyncRow<"category">): SyncCategoryDto {
	return {
		id: row.id,
		name: row.name,
		color: row.color,
		icon: row.icon,
		isFixed: row.isFixed,
		excludeByDefault: row.excludeByDefault,
		kind: row.kind,
	};
}

export function toSyncRecurringTemplate(
	row: SyncRow<"recurring_template">,
): SyncRecurringTemplateDto {
	return {
		id: row.id,
		name: row.name,
		amount: decimal(row.amount),
		currency: row.currency,
		categoryId: row.categoryId,
		direction: row.direction,
		amountMode: row.amountMode,
		frequency: row.frequency,
		nextDueDate: instant(row.nextDueDate),
		anchorDay: row.anchorDay,
		websiteUrl: row.websiteUrl,
		paymentSource: row.paymentSource,
		autoPay: row.autoPay,
		isActive: row.isActive,
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
	};
}

const decimalOrNull = (value: { toFixed(): string } | null) =>
	value ? decimal(value) : null;

export function toSyncAccount(row: SyncRow<"asset_account">): SyncAccountDto {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		currency: row.currency,
		balance: decimal(row.balance),
		exchangeRate: decimalOrNull(row.exchangeRate),
		exchangeRateType: row.exchangeRateType,
		isLiquid: row.isLiquid,
		interestRate: decimalOrNull(row.interestRate),
		minimumPayment: decimalOrNull(row.minimumPayment),
		dueDate: row.dueDate,
		inBudget: row.inBudget,
		countedUnits: decimal(row.countedUnits),
		closedAt: row.closedAt ? instant(row.closedAt) : null,
		iconKind: row.iconKind,
		iconValue: row.iconValue,
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
	};
}

export function toSyncAccountSnapshot(
	row: SyncRow<"asset_snapshot">,
): SyncAccountSnapshotDto {
	return {
		id: row.id,
		accountId: row.accountId,
		date: instant(row.date),
		balance: decimal(row.balance),
		balanceInUSD: decimal(row.balanceInUSD),
		currency: row.currency,
		type: row.type,
		exchangeRateType: row.exchangeRateType,
		recordedAt: instant(row.recordedAt),
	};
}

export function toSyncAccountLeg(
	row: SyncRow<"account_leg">,
): SyncAccountLegDto {
	return {
		id: row.id,
		accountId: row.accountId,
		currency: row.currency,
		amount: decimal(row.amount),
		homeAmount: decimalOrNull(row.homeAmount),
		homeCurrency: row.homeCurrency,
		date: instant(row.date),
		source: row.source,
		transferId: row.transferId,
		expenseId: row.expenseId,
		countedUnits: decimal(row.countedUnits),
		createdAt: instant(row.createdAt),
	};
}

export function toSyncAccountHistory(
	row: SyncRow<"asset_history">,
): SyncAccountHistoryDto {
	return {
		id: row.id,
		assetId: row.assetId,
		balance: decimal(row.balance),
		recordedAt: instant(row.recordedAt),
	};
}

export function toSyncAccountRateType(
	row: SyncRow<"asset_rate_type">,
): SyncAccountRateTypeDto {
	return {
		id: row.id,
		accountId: row.accountId,
		from: instant(row.from),
		type: row.type,
		previousType: row.previousType,
		createdAt: instant(row.createdAt),
	};
}

export function toSyncTransfer(row: SyncRow<"transfer">): SyncTransferDto {
	return {
		id: row.id,
		kind: row.kind,
		date: instant(row.date),
		fromAccountId: row.fromAccountId,
		fromAmount: decimal(row.fromAmount),
		fromCurrency: row.fromCurrency,
		toAccountId: row.toAccountId,
		toAmount: decimal(row.toAmount),
		toCurrency: row.toCurrency,
		referenceRateType: row.referenceRateType,
		feeExpenseId: row.feeExpenseId,
		countedFromUnits: decimal(row.countedFromUnits),
		countedToUnits: decimal(row.countedToUnits),
		note: row.note,
		createdAt: instant(row.createdAt),
	};
}

/** The page with its rows mapped and its tombstones' instants as text. */
async function pageOf<E extends SyncEntity, Dto>(
	caller: Caller,
	entity: E,
	query: SyncQuery,
	map: (row: SyncRow<E>) => Dto,
) {
	const page: SyncPage<SyncRow<E>> = await readChanges(
		caller.db,
		caller.principal.userId,
		entity,
		query,
	);
	return {
		items: page.items.map(map),
		tombstones: page.tombstones.map((t) => ({
			id: t.id,
			deletedAt: instant(t.deletedAt),
		})),
		cursor: page.cursor,
		hasMore: page.hasMore,
	};
}

export const syncExpenses = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "expense", query, toSyncExpense);

export const syncCategories = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "category", query, toSyncCategory);

export const syncRecurringTemplates = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "recurring_template", query, toSyncRecurringTemplate);

export const syncAccounts = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "asset_account", query, toSyncAccount);

export const syncAccountSnapshots = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "asset_snapshot", query, toSyncAccountSnapshot);

export const syncAccountLegs = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "account_leg", query, toSyncAccountLeg);

export const syncAccountHistory = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "asset_history", query, toSyncAccountHistory);

export const syncAccountRateTypes = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "asset_rate_type", query, toSyncAccountRateType);

export const syncTransfers = (caller: Caller, query: SyncQuery) =>
	pageOf(caller, "transfer", query, toSyncTransfer);
