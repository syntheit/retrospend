import type { ComponentType } from "react";
import type { BudgetSheetId } from "../sheet-ids";
import { AssignSheet } from "./assign-sheet";
import { CloseSheet } from "./close-sheet";
import { CoverSheet } from "./cover-sheet";
import { ExplainSheet } from "./explain-sheet";
import { ForgiveSheet } from "./forgive-sheet";
import { FundNowSheet } from "./fund-now-sheet";
import { HelpSheet } from "./help-sheet";
import { RaiseLimitSheet, SetLimitSheet } from "./limit-sheet";
import { MoveSheet } from "./move-sheet";
import { OwedSheet } from "./owed-sheet";
import { PlanSheet } from "./plan-sheet";
import { ReconcileSheet } from "./reconcile-sheet";
import { RulesSheet } from "./rules-sheet";
import { StyleSheet } from "./style-sheet";
import { TakeBackSheet } from "./take-back-sheet";
import type { SheetComponentProps } from "./types";
import { WelcomeBackSheet } from "./welcome-back-sheet";
import { WhatIfSheet } from "./what-if-sheet";

type Registered = {
	[K in BudgetSheetId]?: ComponentType<SheetComponentProps<K>>;
};

/**
 * The sheets that exist, by id. The host opens only what is listed here.
 * Not listed, and why: target, envelope and merge (no server write for
 * targets or envelope edits yet), wealth (the Transfer sheet's envelope
 * route), settle (the Settle up sheet on the person page), debt and payDebt
 * (P6), income, fromWealth, afford, migrate, whatMoved, coverAll and setup
 * (see the report).
 */
export const SHEETS: Registered = {
	assign: AssignSheet,
	close: CloseSheet,
	cover: CoverSheet,
	explain: ExplainSheet,
	forgive: ForgiveSheet,
	fundNow: FundNowSheet,
	help: HelpSheet,
	move: MoveSheet,
	owed: OwedSheet,
	plan: PlanSheet,
	raiseLimit: RaiseLimitSheet,
	reconcile: ReconcileSheet,
	rules: RulesSheet,
	setLimit: SetLimitSheet,
	style: StyleSheet,
	takeBack: TakeBackSheet,
	welcomeBack: WelcomeBackSheet,
	whatIf: WhatIfSheet,
};
