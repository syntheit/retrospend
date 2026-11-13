import type {
	SyncCategoryDto,
	SyncExpenseDto,
	SyncQuery,
	SyncRecurringTemplateDto,
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
