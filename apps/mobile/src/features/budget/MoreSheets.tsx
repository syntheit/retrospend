import { IncomeSheet } from "./IncomeSheet";
import type { MonthKind } from "./months";
import { RulesSheet } from "./RulesSheet";
import type { BudgetMonth } from "./source";

/**
 * The sheets of the plan and tidy list beyond the first six: each is one row
 * there and one sheet here. The Budget tab opens one at a time.
 */
export type MoreKind = "income" | "rules";

export const MORE_KINDS: readonly MoreKind[] = ["income", "rules"];

/** The rows the list adds in the open month, in order. */
export const MORE_ROWS: readonly {
	kind: MoreKind;
	months: readonly MonthKind[];
}[] = [
	{ kind: "income", months: ["open"] },
	{ kind: "rules", months: ["open", "next"] },
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
		</>
	);
}
