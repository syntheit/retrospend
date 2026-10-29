import type { ComponentType } from "react";
import type { SheetDetent } from "@/ui/Sheet";
import { AffordSheet } from "./AffordSheet";
import type { OpenSheet } from "./BudgetSheets";
import { CloseSheet } from "./CloseSheet";
import { FundNowSheet } from "./FundNowSheet";
import { IncomeSheet } from "./IncomeSheet";
import { MergeSheet } from "./MergeSheet";
import type { MonthKind } from "./months";
import { NewEnvelopeSheet } from "./NewEnvelopeSheet";
import { OwedSheet } from "./OwedSheet";
import { PayDebtSheet } from "./PayDebtSheet";
import { PlanApplySheet } from "./PlanApplySheet";
import { PlanSheet } from "./PlanSheet";
import { ReconcileSheet } from "./ReconcileSheet";
import { RulesSheet } from "./RulesSheet";
import { StartingMoneySheet } from "./StartingMoneySheet";
import { StyleSheet } from "./StyleSheet";
import type { BudgetMonth } from "./source";
import { TakeBackSheet } from "./TakeBackSheet";
import { UnroutedSheet } from "./UnroutedSheet";
import { UsePlanSheet } from "./UsePlanSheet";
import { WealthMoveSheet } from "./WealthMoveSheet";
import { WelcomeBackSheet } from "./WelcomeBackSheet";
import { WhatIfSheet } from "./WhatIfSheet";

/** Every sheet of the Budget tab except an envelope's, which has modes of its own. */
export type SheetKind = Exclude<OpenSheet["kind"], "envelope">;

/** What the registry hands every sheet. A sheet takes the parts it needs. */
export interface SheetProps {
	data: BudgetMonth;
	kind: MonthKind;
	/** The kind of sheet the registry is rendering is the one on screen. */
	visible: boolean;
	/** The height this kind rests at (see `SHEETS`). */
	detent: SheetDetent;
	onClose: () => void;
	onDone: () => void;
	onOpen: (sheet: OpenSheet) => void;
}

interface SheetEntry {
	component: ComponentType<SheetProps>;
	detent: SheetDetent;
}

/**
 * The one list of Budget sheets: what each kind is and the height it rests
 * at. Medium is a short task (a confirm, one amount, a read with a few
 * lines); large is a long form or a list. The screen mounts each entry once
 * and shows the one `OpenSheet` names.
 */
export const SHEETS: Record<SheetKind, SheetEntry> = {
	usePlan: {
		detent: "large",
		component: (p) => <UsePlanSheet {...p} />,
	},
	takeBack: {
		detent: "medium",
		component: (p) => <TakeBackSheet {...p} />,
	},
	afford: {
		detent: "medium",
		component: (p) => (
			<AffordSheet
				{...p}
				onMove={(id) => p.onOpen({ kind: "envelope", id, mode: "move" })}
			/>
		),
	},
	newEnvelope: {
		detent: "large",
		component: (p) => <NewEnvelopeSheet {...p} />,
	},
	merge: {
		detent: "large",
		component: (p) => <MergeSheet {...p} />,
	},
	style: {
		detent: "large",
		component: (p) => <StyleSheet {...p} />,
	},
	payDebt: {
		detent: "large",
		component: (p) => <PayDebtSheet {...p} />,
	},
	reconcile: {
		detent: "large",
		component: (p) => <ReconcileSheet {...p} />,
	},
	income: {
		detent: "medium",
		component: (p) => <IncomeSheet {...p} />,
	},
	rules: {
		detent: "large",
		component: (p) => <RulesSheet {...p} />,
	},
	owed: {
		detent: "medium",
		component: (p) => <OwedSheet {...p} />,
	},
	unrouted: {
		detent: "large",
		component: (p) => <UnroutedSheet {...p} />,
	},
	whatIf: {
		detent: "medium",
		component: (p) => <WhatIfSheet {...p} />,
	},
	plan: {
		detent: "large",
		component: (p) => <PlanSheet {...p} />,
	},
	planApply: {
		detent: "large",
		component: (p) => <PlanApplySheet {...p} />,
	},
	fundNow: {
		detent: "large",
		component: (p) => <FundNowSheet {...p} next={p.kind === "next"} />,
	},
	close: {
		detent: "large",
		component: (p) => <CloseSheet {...p} />,
	},
	welcomeBack: {
		detent: "large",
		component: (p) => <WelcomeBackSheet {...p} />,
	},
	startingMoney: {
		detent: "large",
		component: (p) => <StartingMoneySheet {...p} />,
	},
	toWealth: {
		detent: "large",
		component: (p) => <WealthMoveSheet {...p} direction="to" />,
	},
	fromWealth: {
		detent: "large",
		component: (p) => <WealthMoveSheet {...p} direction="from" />,
	},
};

export const SHEET_KINDS = Object.keys(SHEETS) as SheetKind[];
