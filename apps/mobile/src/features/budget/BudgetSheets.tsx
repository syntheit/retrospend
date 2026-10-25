import { type EnvelopeMode, EnvelopeSheet } from "./EnvelopeSheet";
import type { MonthKind } from "./months";
import { type BudgetMonth, envelopeById } from "./source";
import { TakeBackSheet } from "./TakeBackSheet";
import { UsePlanSheet } from "./UsePlanSheet";

/** The sheet on screen, if any: one at a time. */
export type OpenSheet =
	| { kind: "envelope"; id: string; mode: EnvelopeMode }
	| { kind: "usePlan" }
	| { kind: "takeBack" };

/** Every sheet the Budget tab can present, closed unless `sheet` names it. */
export function BudgetSheets({
	data,
	kind,
	sheet,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	kind: MonthKind;
	sheet: OpenSheet | null;
	onClose: () => void;
	onDone: () => void;
}) {
	const envelope =
		sheet?.kind === "envelope" ? envelopeById(data, sheet.id) : null;
	return (
		<>
			<EnvelopeSheet
				data={data}
				envelope={envelope}
				kind={kind}
				month={data.month.key}
				onClose={onClose}
				onDone={onDone}
				startMode={sheet?.kind === "envelope" ? sheet.mode : "overview"}
			/>
			<UsePlanSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={sheet?.kind === "usePlan"}
			/>
			<TakeBackSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={sheet?.kind === "takeBack"}
			/>
		</>
	);
}
