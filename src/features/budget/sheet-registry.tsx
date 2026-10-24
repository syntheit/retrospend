"use client";

import type { ComponentType } from "react";
import type { BudgetSheetArgs, BudgetSheetId } from "./sheet-ids";

/** What a sheet component receives: its arguments, and a way to close. */
export type BudgetSheetProps<Id extends BudgetSheetId> = {
	args: BudgetSheetArgs[Id];
	/** Close the sheet; Cancel and a finished save both call it. */
	onClose: () => void;
};

export type BudgetSheets = {
	[Id in BudgetSheetId]?: ComponentType<BudgetSheetProps<Id>>;
};

/**
 * The sheets that exist, by id. The Budget page opens a sheet that is not
 * here as a no-op, so the page ships before every sheet does. The sheets
 * agent adds each sheet as it lands: import the component and list it.
 */
export const BUDGET_SHEETS: BudgetSheets = {};
