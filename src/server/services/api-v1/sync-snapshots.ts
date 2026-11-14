import type { SyncSettingsDto, SyncSharesDto } from "@retrospend/api-contract";
import { FigureUnavailable } from "~/server/figures/unavailable";
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

export async function syncShares(caller: Caller): Promise<SyncSharesDto> {
	const snapshot = await readShareSnapshot(caller.db, caller.principal.userId);
	return {
		items: snapshot.shares.map(toSyncShare),
		owed: toSyncOwed(snapshot.owed),
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
