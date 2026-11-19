/**
 * Reference data a write reads and never writes: the user's settings and the
 * rate table. Repositories expose them read-only, so a write function cannot
 * change what it prices with.
 */
import { tableReads } from "./crud";
import { NotFoundError } from "./errors";
import { type Reader, SETTINGS_ID, type SettingsRow } from "./port";

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
