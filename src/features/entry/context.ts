"use client";

import { createContext, useContext } from "react";
import type { EntryRequest } from "./types";

export type EntrySheets = {
	/** Opens one Add family sheet; the one already open closes first. */
	open: (request: EntryRequest) => void;
	close: () => void;
};

export const EntrySheetsContext = createContext<EntrySheets | null>(null);

/** The Add family sheets (v2 shell only): Add expense, Add income, Transfer, the read view. */
export function useEntrySheets(): EntrySheets {
	const sheets = useContext(EntrySheetsContext);
	if (!sheets)
		throw new Error("useEntrySheets must be used inside EntrySheetsProvider");
	return sheets;
}
