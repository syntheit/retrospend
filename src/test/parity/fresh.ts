/**
 * What a device values that the server has not kept (E2EE P13b). The budget
 * block carries the value every foreign row of the user was first valued at;
 * a device that finds a row the block does not cover values it itself, at the
 * rates it holds, and the loader lists it in `fresh`. For a row the block
 * covers (one the server stamped before the block's position, `asOf`) that list
 * must be empty. A row newer than `asOf` may be valued on the device alone until
 * the next pull; parity names those rows instead of skipping them, so a static
 * ledger that shows one is a failure, not a silent pass.
 */
import { closedIncomesFrom } from "@retrospend/domain/envelope/income-history";
import { loadBookFrom } from "@retrospend/domain/envelope/load-book";
import { cursorPosition } from "../../../packages/engine/src/budget-gate";
import {
	closedIncomeRows,
	storeBookSource,
} from "../../../packages/engine/src/budget-source";
import type { Reader } from "../../../packages/engine/src/index";
import { adminDb } from "../pg-harness";

export interface FreshReport {
	/** Row ids the device valued itself that the server stamped at or before `asOf`: values the block should hold. */
	below: string[];
	/** Row ids the device valued itself that were stamped after `asOf`: newer than the block, named here. */
	newer: string[];
}

/** The ids of the rows the device valued for the first time reading the book at `now`, closed months' income included (the plan cost reads it). */
export async function deviceFreshIds(
	store: Reader,
	userId: string,
	now: Date,
): Promise<string[]> {
	const load = await loadBookFrom(storeBookSource(store, { userId }), { now });
	if (!load) return [];
	await closedIncomesFrom(
		async (w) => closedIncomeRows(store, undefined, w),
		load.loaded,
	);
	return [
		...new Set(
			load.loaded.valuer.fresh.map((f) => f.key.split("|")[0] as string),
		),
	];
}

/** Splits the device's fresh rows by whether they are newer than the block's `asOf`. */
export async function freshReport(
	store: Reader,
	userId: string,
	now: Date,
): Promise<FreshReport> {
	const ids = await deviceFreshIds(store, userId, now);
	const asOf = store.get("budgetSnapshot", "budget")?.asOf;
	const at = asOf ? cursorPosition(asOf) : null;
	if (ids.length === 0 || !at) return { below: ids, newer: [] };
	const stamped = await adminDb.$queryRaw<{ entityId: string }[]>`
		SELECT DISTINCT "entityId" FROM "sync_change"
		WHERE "userId" = ${userId} AND "entity" = 'expense'
		  AND "entityId" = ANY(${ids}) AND "txid" > ${at.t}::xid8`;
	const newer = new Set(stamped.map((r) => r.entityId));
	return {
		below: ids.filter((id) => !newer.has(id)),
		newer: ids.filter((id) => newer.has(id)),
	};
}
