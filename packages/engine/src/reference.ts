/**
 * Reference data a write reads and never writes: the user's settings and the
 * rate table. Repositories expose them read-only, so a write function cannot
 * change what it prices with.
 */
import { tableReads, tableWrites } from "./crud";
import { NotFoundError } from "./errors";
import {
	type Reader,
	SETTINGS_ID,
	type SettingsRow,
	type TableRows,
	type Writer,
} from "./port";

export function settingsReads(r: Reader) {
	return {
		get: (): SettingsRow | undefined => r.get("settings", SETTINGS_ID),
		/** The settings row; a store without one throws NotFoundError. */
		require(): SettingsRow {
			const row = r.get("settings", SETTINGS_ID);
			if (!row) throw new NotFoundError("settings does not exist");
			return row;
		},
	};
}

export const rateReads = (r: Reader) => tableReads(r, "rates");

export const categoryReads = (r: Reader) => tableReads(r, "categories");

export const transferReads = (r: Reader) => tableReads(r, "transfers");

/** A transfer the device books or takes back; a pull writes the same rows through sync-apply. */
export const transferRepo = (w: Writer) => {
	const rows = tableWrites(w, "transfers");
	return {
		...transferReads(w),
		/** Adds the move; an id already in use throws InvalidInputError. */
		insert: (row: TableRows["transfers"]) => rows.insert(row),
		/** True when the move existed. */
		remove: (id: string) => rows.remove(id),
	};
};

/** The budget's side of a move (the rows of envelope/wealth.service); read only: only a pull changes them. */
export const wealthMoveReads = (r: Reader) => tableReads(r, "wealthTransfers");

/**
 * The kind a row takes from its category: the category's, or null for none or
 * one the store does not hold (it joins when the category arrives). The one
 * derivation for a pull, an edit and a restored delete.
 */
export function categoryKindOf(
	categoryId: string | null | undefined,
	find: (id: string) => { readonly kind: string } | undefined,
): string | null {
	return categoryId ? (find(categoryId)?.kind ?? null) : null;
}
