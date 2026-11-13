/**
 * The tables whose rows sync to devices as a delta (E2EE lane P, P14a). The
 * entity name is the table name, which is what sync_stamp_rows writes into
 * "sync_change"."entity". The same nine tables carry the three triggers in
 * 20261114100000_sync_change; sync.pg.test.ts fails when this list and the
 * catalog disagree.
 *
 * A loader reads the live rows of one entity by id for one owner through the
 * Prisma model and never through raw SQL, so the field-open extension opens
 * sealed text on the way out (E2EE D11). It asks for the id and the owner
 * both: a row that changed hands, or that the caller may not read, is missing
 * and reads as deleted.
 */
import type { Prisma } from "~prisma";

export const SYNCED_ENTITIES = [
	"expense",
	"category",
	"recurring_template",
	"asset_account",
	"asset_snapshot",
	"asset_history",
	"account_leg",
	"transfer",
	"asset_rate_type",
] as const;

export type SyncEntity = (typeof SYNCED_ENTITIES)[number];

type Tx = Prisma.TransactionClient;

export const SYNC_LOADERS = {
	expense: (tx: Tx, ids: string[], userId: string) =>
		tx.expense.findMany({ where: { id: { in: ids }, userId } }),
	category: (tx: Tx, ids: string[], userId: string) =>
		tx.category.findMany({ where: { id: { in: ids }, userId } }),
	recurring_template: (tx: Tx, ids: string[], userId: string) =>
		tx.recurringTemplate.findMany({ where: { id: { in: ids }, userId } }),
	asset_account: (tx: Tx, ids: string[], userId: string) =>
		tx.assetAccount.findMany({ where: { id: { in: ids }, userId } }),
	asset_snapshot: (tx: Tx, ids: string[], userId: string) =>
		tx.assetSnapshot.findMany({ where: { id: { in: ids }, userId } }),
	asset_history: (tx: Tx, ids: string[], userId: string) =>
		tx.assetHistory.findMany({ where: { id: { in: ids }, userId } }),
	account_leg: (tx: Tx, ids: string[], userId: string) =>
		tx.accountLeg.findMany({ where: { id: { in: ids }, userId } }),
	transfer: (tx: Tx, ids: string[], userId: string) =>
		tx.transfer.findMany({ where: { id: { in: ids }, userId } }),
	asset_rate_type: (tx: Tx, ids: string[], userId: string) =>
		tx.assetRateType.findMany({ where: { id: { in: ids }, userId } }),
} satisfies Record<
	SyncEntity,
	(tx: Tx, ids: string[], userId: string) => Promise<{ id: string }[]>
>;

/** The row type one entity's loader returns. */
export type SyncRow<E extends SyncEntity> = Awaited<
	ReturnType<(typeof SYNC_LOADERS)[E]>
>[number];

export function isSyncEntity(value: string): value is SyncEntity {
	return (SYNCED_ENTITIES as readonly string[]).includes(value);
}
