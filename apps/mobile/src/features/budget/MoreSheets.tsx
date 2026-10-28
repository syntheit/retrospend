import { IncomeSheet } from "./IncomeSheet";
import type { MonthKind } from "./months";
import { OwedSheet } from "./OwedSheet";
import { RulesSheet } from "./RulesSheet";
import type { BudgetMonth } from "./source";
import { UnroutedSheet } from "./UnroutedSheet";

/**
 * The sheets of the plan and tidy list beyond the first six: each is one row
 * there and one sheet here. The Budget tab opens one at a time.
 */
export type MoreKind = "income" | "rules" | "owed" | "unrouted";

export const MORE_KINDS: readonly MoreKind[] = [
	"income",
	"rules",
	"owed",
	"unrouted",
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
];

export function MoreSheets({
	data,
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
			<UnroutedSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={open === "unrouted"}
			/>
		</>
	);
}
