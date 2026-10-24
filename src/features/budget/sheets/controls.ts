"use client";

import { createContext, useContext } from "react";
import type { OpenSheet } from "./types";

export type Controls = { open: OpenSheet; close: () => void };

export const SheetsContext = createContext<Controls | null>(null);

/** `open(id, params)` and `close()` for the Budget sheets. */
export function useBudgetSheets(): Controls {
	const controls = useContext(SheetsContext);
	if (!controls)
		throw new Error("useBudgetSheets needs a BudgetSheetsProvider above it");
	return controls;
}
