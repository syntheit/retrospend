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
import { AssignSheet } from "./assign-sheet";
import { CloseSheet } from "./close-sheet";
import { CoverSheet } from "./cover-sheet";
import { ExplainSheet } from "./explain-sheet";
import { FundNowSheet } from "./fund-now-sheet";
import { HelpSheet } from "./help-sheet";
import { RaiseLimitSheet, SetLimitSheet } from "./limit-sheet";
import { MoveSheet } from "./move-sheet";
import { OwedSheet } from "./owed-sheet";
import { PlanSheet } from "./plan-sheet";
import { ReconcileSheet } from "./reconcile-sheet";
import { RulesSheet } from "./rules-sheet";
import { SetupSheet } from "./setup-sheet";
import { StyleSheet } from "./style-sheet";
import { TakeBackSheet } from "./take-back-sheet";
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
};
