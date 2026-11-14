import type {
	SyncSettingsDto,
	SyncSharesDto,
	SyncSharesQuery,
} from "@retrospend/api-contract";
import { FigureUnavailable } from "~/server/figures/unavailable";
import type { BudgetRead } from "~/server/services/sync/budget-block";
import {
	readSettingsSnapshot,
	readShareSnapshot,
	type ShareSnapshot,
	type ShareSnapshotRow,
} from "~/server/services/sync/snapshots";
import type { Caller } from "./caller";
import { decimal, decimalOrNull, instant } from "./sync";

/**
 * v1 adapters for the sync snapshots (P16): the readers' rows in their wire
 * form, every field named so a column added to a table cannot reach a device
 * until someone decides it may.
 */

export function toSyncShare(
	row: ShareSnapshotRow,
): SyncSharesDto["items"][number] {
	return {
		id: row.id,
		expenseId: row.expenseId,
		shareAmount: decimal(row.shareAmount),
		verificationStatus: row.verificationStatus,
		currency: row.currency,
		date: instant(row.date),
		projectId: row.projectId,
		exchangeRate: decimalOrNull(row.exchangeRate),
		expenseCategoryId: row.expenseCategoryId,
	};
}

/** Owed to you and You owe as the wire Money pair, or the currencies that keep them out. */
export function toSyncOwed(owed: ShareSnapshot["owed"]): SyncSharesDto["owed"] {
	if (owed instanceof FigureUnavailable)
		return { missingRates: [...owed.missingRates] };
	return {
		owedToYou: { minor: owed.owedToYou, currency: owed.currency },
		youOwe: { minor: owed.youOwe, currency: owed.currency },
	};
}

/**
 * The budget block as the wire form: the shares as entries with every field
 * named, the rest as the domain block holds it (plain data, no row of a table).
 */
export function toSyncBudget(read: BudgetRead): SyncSharesDto["budget"] {
	if (read.kind === "none") return null;
	if (read.kind === "unavailable") return { unavailable: true };
	const { block } = read;
	return {
		bookId: block.bookId,
		valuationKey: block.valuationKey,
		asOf: block.asOf,
		frozen: block.frozen.map((f) => ({
			key: f.key,
			minor: f.minor,
			approximate: f.approximate,
		})),
		splits: {
			...block.splits,
			shares: block.splits.shares.map((e) => ({
				id: e.id,
				month: e.month,
				date: e.date,
				minor: e.minor,
				source: "SHARE" as const,
				categoryId: e.categoryId,
				envelopeId: e.envelopeId ?? null,
				pending: e.pending ?? false,
			})),
		},
	};
}

export async function syncShares(
	caller: Caller,
	query: SyncSharesQuery = {},
): Promise<SyncSharesDto> {
	const snapshot = await readShareSnapshot(caller.db, caller.principal.userId, {
		budget: query.budget === "1",
	});
	return {
		items: snapshot.shares.map(toSyncShare),
		owed: toSyncOwed(snapshot.owed),
		...(snapshot.budget ? { budget: toSyncBudget(snapshot.budget) } : {}),
	};
}

export async function syncSettings(caller: Caller): Promise<SyncSettingsDto> {
	const settings = await readSettingsSnapshot(
		caller.db,
		caller.principal.userId,
	);
	return {
		homeCurrency: settings.homeCurrency,
		timeZone: settings.timeZone,
		startDay: settings.startDay,
		hiddenProjectIds: settings.hiddenProjectIds,
		defaultRateTypes: settings.defaultRateTypes,
	};
}
