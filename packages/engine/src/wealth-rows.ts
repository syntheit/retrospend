/** What a device may keep outside the store for an account and a transfer: no text. */
import type { TableRows } from "./port";

type AccountRow = TableRows["accounts"];
type TransferRow = TableRows["transfers"];

/**
 * The account columns that hold a person's free text. A src test holds this
 * list equal to the keys of FIELD_MAP.AssetAccount.columns, which the engine
 * cannot import.
 */
export const ACCOUNT_TEXT_COLUMNS = ["name"] as const;

/** The transfer columns that hold a person's free text (FIELD_MAP.Transfer, held by the same test). */
export const TRANSFER_TEXT_COLUMNS = ["note"] as const;

export type TextFreeAccountRow = Omit<
	AccountRow,
	(typeof ACCOUNT_TEXT_COLUMNS)[number]
>;
export type TextFreeTransferRow = Omit<
	TransferRow,
	(typeof TRANSFER_TEXT_COLUMNS)[number]
>;

function without(
	row: object,
	columns: readonly string[],
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...row };
	for (const column of columns) delete out[column];
	return out;
}

/** The row as the device may hold it outside the store: every column except the name. */
export const accountWithoutText = (row: AccountRow) =>
	without(row, ACCOUNT_TEXT_COLUMNS) as TextFreeAccountRow;

/** The row as the device may hold it outside the store: every column except the note. */
export const transferWithoutText = (row: TransferRow) =>
	without(row, TRANSFER_TEXT_COLUMNS) as TextFreeTransferRow;
