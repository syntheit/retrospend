import type { ComponentType } from "react";
import type { BudgetSheetId } from "../sheet-ids";
import { AssignSheet } from "./assign-sheet";
import { CoverSheet } from "./cover-sheet";
import { MoveSheet } from "./move-sheet";
import { PlanSheet } from "./plan-sheet";
import type { SheetComponentProps } from "./types";

type Registered = {
	[K in BudgetSheetId]?: ComponentType<SheetComponentProps<K>>;
};

/** The sheets that exist, by id. The host opens only what is listed here. */
export const SHEETS: Registered = {
	assign: AssignSheet,
	cover: CoverSheet,
	move: MoveSheet,
	plan: PlanSheet,
};
