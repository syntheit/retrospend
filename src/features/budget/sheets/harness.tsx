"use client";

import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { TooltipProvider } from "~/components/ui/tooltip";
import { BudgetSheetsProvider, useBudgetSheet } from "../use-budget-sheet";
import { useMonth } from "./use-month";

/** Sheets that need nothing but the month; each opens from one button. */
const SIMPLE = [
	"assign",
	"usePlan",
	"rules",
	"help",
	"owed",
	"takeBack",
	"style",
	"reconcile",
	"welcomeBack",
	"setLimit",
	"whatIf",
	"move",
	"fundNow",
	"setup",
	"coverAll",
	"debt",
	"payDebt",
	"fromWealth",
	"planApply",
	"income",
	"splits",
] as const;

function Harness() {
	const sheets = useBudgetSheet();
	const m = useMonth(undefined);
	const month = m.monthKey ?? 0;
	const open = sheets.open as (id: string, args: object) => void;
	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
			<h1 className="text-section text-fg">Budget sheets</h1>
			{m.data ? (
				<p className="text-fg-2 text-body">
					<Money figure="budget.notPlannedYet" value={m.data.toAssign.amount} />
				</p>
			) : (
				<p className="text-fg-3 text-body">No budget</p>
			)}
			<div className="flex flex-wrap gap-2">
				{SIMPLE.map((id) => (
					<Button
						data-sheet-opener={id}
						key={id}
						onClick={() => open(id, { month })}
					>
						{id}
					</Button>
				))}
				<Button
					data-sheet-opener="explain"
					onClick={() =>
						open("explain", { month, figure: "budget.notPlannedYet" })
					}
				>
					explain
				</Button>
			</div>
			<ul className="flex flex-col gap-1">
				{m.envelopes.map((e) => (
					<li
						className="flex flex-wrap items-center justify-between gap-3"
						data-envelope={e.name}
						key={e.id}
					>
						<span className="text-body text-fg">{e.name}</span>
						<Money figure="envelope.left" value={e.left} />
						<span className="flex flex-wrap gap-2">
							<Button
								onClick={() => open("move", { month, envelopeId: e.id })}
								size="sm"
							>
								Move {e.name}
							</Button>
							{e.status === "OVERSPENT" ? (
								<Button
									onClick={() => open("cover", { month, envelopeId: e.id })}
									size="sm"
								>
									Cover {e.name}
								</Button>
							) : null}
							{e.kind === "MONTHLY" ? (
								<Button
									onClick={() =>
										open("raiseLimit", { month, envelopeId: e.id })
									}
									size="sm"
								>
									Raise {e.name}
								</Button>
							) : null}
							<Button
								onClick={() => open("toWealth", { month, envelopeId: e.id })}
								size="sm"
							>
								To Wealth {e.name}
							</Button>
							<Button
								onClick={() => open("planEdit", { month, envelopeId: e.id })}
								size="sm"
							>
								Plan {e.name}
							</Button>
							<Button
								onClick={() =>
									open("explain", {
										month,
										figure: "envelope.left",
										envelopeId: e.id,
									})
								}
								size="sm"
							>
								Explain {e.name}
							</Button>
						</span>
					</li>
				))}
			</ul>
		</main>
	);
}

/** The dev page that hosts the Budget sheets until the Budget page opens them. */
export function BudgetSheetsHarness() {
	return (
		<TooltipProvider>
			<BudgetSheetsProvider>
				<Harness />
			</BudgetSheetsProvider>
		</TooltipProvider>
	);
}
