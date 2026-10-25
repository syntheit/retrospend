"use client";

import {
	type ComponentType,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { SettleSheet } from "~/features/settle/settle-sheet";
import { api } from "~/trpc/react";
import type { BudgetSheetArgs, BudgetSheetId } from "../sheet-ids";
import type { BudgetSheetProps, BudgetSheets } from "../sheet-registry";
import { AffordSheet } from "./afford-sheet";
import { AssignSheet } from "./assign-sheet";
import { CloseSheet } from "./close-sheet";
import { ConfirmPaymentSheet } from "./confirm-payment-sheet";
import { CoverAllSheet } from "./cover-all-sheet";
import { CoverSheet } from "./cover-sheet";
import { DebtSheet } from "./debt-sheet";
import { EditEnvelopeSheet } from "./edit-envelope-sheet";
import { ExplainSheet } from "./explain-sheet";
import { FromWealthSheet } from "./from-wealth-sheet";
import { FundNowSheet } from "./fund-now-sheet";
import { HelpSheet } from "./help-sheet";
import { IncomeSheet } from "./income-sheet";
import { RaiseLimitSheet, SetLimitSheet } from "./limit-sheet";
import { MergeEnvelopesSheet } from "./merge-envelopes-sheet";
import { MoveSheet } from "./move-sheet";
import { NewEnvelopeSheet } from "./new-envelope-sheet";
import { OwedSheet } from "./owed-sheet";
import { PayDebtSheet } from "./pay-debt-sheet";
import { PlanApplySheet } from "./plan-apply-sheet";
import { PlanEditSheet } from "./plan-edit-sheet";
import { PlanSheet } from "./plan-sheet";
import { ReconcileSheet } from "./reconcile-sheet";
import { RulesSheet } from "./rules-sheet";
import { SetupSheet } from "./setup-sheet";
import { SplitsSheet } from "./splits-sheet";
import { StartingMoneySheet } from "./starting-money-sheet";
import { StyleSheet } from "./style-sheet";
import { TakeBackSheet } from "./take-back-sheet";
import { TargetSheet } from "./target-sheet";
import { ToWealthSheet } from "./to-wealth-sheet";
import type { SheetProps } from "./types";
import { WelcomeBackSheet } from "./welcome-back-sheet";
import { WhatIfSheet } from "./what-if-sheet";

/** How long a sheet takes to animate closed (the token's 220ms) before the page lets go of it. */
const CLOSE_MS = 220;

/**
 * Keeps a sheet mounted while it animates closed: the page unmounts the
 * sheet the moment `onClose` runs, which would cut the animation off.
 */
function Closing({
	onClose,
	children,
}: {
	onClose: () => void;
	children: (shell: { open: boolean; onClose: () => void }) => ReactNode;
}) {
	const [open, setOpen] = useState(true);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const close = useCallback(() => {
		setOpen(false);
		timer.current = setTimeout(onClose, CLOSE_MS);
	}, [onClose]);
	return <>{children({ open, onClose: close })}</>;
}

/** A sheet of this folder as the page's registry wants it: its arguments picked, its closing kept. */
function adapt<
	Id extends BudgetSheetId,
	A extends object = Record<never, never>,
>(
	Component: ComponentType<SheetProps<A>>,
	pick?: (args: BudgetSheetArgs[Id]) => A,
): ComponentType<BudgetSheetProps<Id>> {
	return function Adapted({ args, onClose }: BudgetSheetProps<Id>) {
		const own = (pick ? pick(args) : {}) as A;
		return (
			<Closing onClose={onClose}>
				{(shell) => (
					<Component
						{...shell}
						{...own}
						month={(args as { month: number }).month}
					/>
				)}
			</Closing>
		);
	};
}

/** Settle up from the budget: the one Settle up sheet, for the person the page names. */
function SettleFromBudget({ args, onClose }: BudgetSheetProps<"settle">) {
	const people = api.people.overview.useQuery();
	const person =
		people.data?.people.find((p) => p.person.key === args.personKey)?.person ??
		null;
	return <SettleSheet onClose={onClose} person={person} />;
}

/** The Budget sheets that exist, by the page's ids. */
export const SHEET_ADAPTERS: BudgetSheets = {
	assign: adapt(AssignSheet),
	cover: adapt(CoverSheet, (a: BudgetSheetArgs["cover"]) => ({
		envelopeId: a.envelopeId,
	})),
	move: adapt(MoveSheet, (a: BudgetSheetArgs["move"]) => ({
		envelopeId: a.envelopeId,
		direction: a.direction,
		amountMinor: a.amountMinor,
	})),
	usePlan: adapt(PlanSheet),
	takeBack: adapt(TakeBackSheet),
	raiseLimit: adapt(RaiseLimitSheet, (a: BudgetSheetArgs["raiseLimit"]) => ({
		envelopeId: a.envelopeId,
	})),
	setLimit: adapt(SetLimitSheet),
	whatIf: adapt(WhatIfSheet, (a: BudgetSheetArgs["whatIf"]) => ({
		envelopeId: a.envelopeId,
	})),
	style: adapt(StyleSheet),
	help: adapt(HelpSheet),
	rules: adapt(RulesSheet),
	owed: adapt(OwedSheet),
	settle: SettleFromBudget,
	monthSummary: adapt(CloseSheet, (a: BudgetSheetArgs["monthSummary"]) => ({
		closedMonth: a.month,
	})),
	explain: adapt(ExplainSheet, (a: BudgetSheetArgs["explain"]) => ({
		figure: a.figure,
		envelopeId: a.envelopeId,
		groupId: a.groupId,
	})),
	fundNow: adapt(FundNowSheet),
	welcomeBack: adapt(WelcomeBackSheet),
	reconcile: adapt(ReconcileSheet),
	setup: adapt(SetupSheet),
	coverAll: adapt(CoverAllSheet),
	debt: adapt(DebtSheet),
	payDebt: adapt(PayDebtSheet, (a: BudgetSheetArgs["payDebt"]) => ({
		envelopeId: a.envelopeId,
	})),
	toWealth: adapt(ToWealthSheet, (a: BudgetSheetArgs["toWealth"]) => ({
		envelopeId: a.envelopeId,
	})),
	fromWealth: adapt(FromWealthSheet, (a: BudgetSheetArgs["fromWealth"]) => ({
		envelopeId: a.envelopeId,
	})),
	planEdit: adapt(PlanEditSheet, (a: BudgetSheetArgs["planEdit"]) => ({
		envelopeId: a.envelopeId,
	})),
	planApply: adapt(PlanApplySheet),
	confirmPayment: adapt(
		ConfirmPaymentSheet,
		(a: BudgetSheetArgs["confirmPayment"]) => ({ paymentId: a.paymentId }),
	),
	splits: adapt(SplitsSheet),
	income: adapt(IncomeSheet),
	target: adapt(TargetSheet, (a: BudgetSheetArgs["target"]) => ({
		envelopeId: a.envelopeId,
	})),
	newEnvelope: adapt(NewEnvelopeSheet),
	editEnvelope: adapt(
		EditEnvelopeSheet,
		(a: BudgetSheetArgs["editEnvelope"]) => ({
			envelopeId: a.envelopeId,
		}),
	),
	mergeEnvelopes: adapt(MergeEnvelopesSheet),
	startingMoney: adapt(StartingMoneySheet),
	afford: adapt(AffordSheet),
};
