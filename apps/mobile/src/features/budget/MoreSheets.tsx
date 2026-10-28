import { FundNowSheet } from "./FundNowSheet";
import { IncomeSheet } from "./IncomeSheet";
import type { MonthKind } from "./months";
import { OwedSheet } from "./OwedSheet";
import { PlanApplySheet } from "./PlanApplySheet";
import { PlanSheet } from "./PlanSheet";
import { RulesSheet } from "./RulesSheet";
import type { BudgetMonth } from "./source";
import { UnroutedSheet } from "./UnroutedSheet";
import { WhatIfSheet } from "./WhatIfSheet";

/**
 * The sheets of the plan and tidy list beyond the first six: each is one row
 * there and one sheet here. The Budget tab opens one at a time.
 */
export type MoreKind =
	| "income"
	| "rules"
	| "owed"
	| "unrouted"
	| "whatIf"
	| "plan"
	| "planApply"
	| "fundNow";

export const MORE_KINDS: readonly MoreKind[] = [
	"income",
	"rules",
	"owed",
	"unrouted",
	"whatIf",
	"plan",
	"planApply",
	"fundNow",
];

/** The rows the list adds, in order, and the kinds of month they show in. */
export const MORE_ROWS: readonly {
	kind: MoreKind;
	months: readonly MonthKind[];
}[] = [
	{ kind: "income", months: ["open"] },
	{ kind: "rules", months: ["open", "next"] },
	{ kind: "owed", months: ["open"] },
	{ kind: "unrouted", months: ["open"] },
	{ kind: "whatIf", months: ["open"] },
	{ kind: "plan", months: ["next"] },
	{ kind: "planApply", months: ["next"] },
	{ kind: "fundNow", months: ["open", "next"] },
];

export function MoreSheets({
	data,
	kind,
	open,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	kind: MonthKind;
	open: string | null;
	onClose: () => void;
	onDone: () => void;
	onOpen: (sheet: { kind: MoreKind }) => void;
}) {
	return (
		<>
			<IncomeSheet data={data} onClose={onClose} visible={open === "income"} />
			<RulesSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={open === "rules"}
			/>
			<OwedSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={open === "owed"}
			/>
			<WhatIfSheet data={data} onClose={onClose} visible={open === "whatIf"} />
			<PlanSheet data={data} onClose={onClose} visible={open === "plan"} />
			<PlanApplySheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={open === "planApply"}
			/>
			<FundNowSheet
				data={data}
				next={kind === "next"}
				onClose={onClose}
				onDone={onDone}
				visible={open === "fundNow"}
			/>
			<UnroutedSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={open === "unrouted"}
			/>
		</>
	);
}
