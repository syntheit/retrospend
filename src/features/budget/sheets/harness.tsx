"use client";

import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { TooltipProvider } from "~/components/ui/tooltip";
import type { BudgetSheetId } from "../sheet-ids";
import { BudgetSheetsProvider, useBudgetSheets } from "./host";
import { SHEETS } from "./registry";
import { useMonth } from "./use-month";

/** Sheets that need no envelope; each opens from one button. */
const SIMPLE = (Object.keys(SHEETS) as BudgetSheetId[]).filter(
	(id) => id !== "cover" && id !== "move",
);

function Harness() {
	const sheets = useBudgetSheets();
	const m = useMonth(undefined);
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
						onClick={() => sheets.open(id as never)}
					>
						{id}
					</Button>
				))}
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
								onClick={() => sheets.open("move", { envelopeId: e.id })}
								size="sm"
							>
								Move {e.name}
							</Button>
							{e.status === "OVERSPENT" ? (
								<Button
									onClick={() => sheets.open("cover", { envelopeId: e.id })}
									size="sm"
								>
									Cover {e.name}
								</Button>
							) : null}
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
