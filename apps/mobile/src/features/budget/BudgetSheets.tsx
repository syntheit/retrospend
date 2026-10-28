import { AffordSheet } from "./AffordSheet";
import { type EnvelopeMode, EnvelopeSheet } from "./EnvelopeSheet";
import { MergeSheet } from "./MergeSheet";
import type { MonthKind } from "./months";
import { NewEnvelopeSheet } from "./NewEnvelopeSheet";
import { PayDebtSheet } from "./PayDebtSheet";
import { ReconcileSheet } from "./ReconcileSheet";
import { StyleSheet } from "./StyleSheet";
import { type BudgetMonth, envelopeById } from "./source";
import { TakeBackSheet } from "./TakeBackSheet";
import { UsePlanSheet } from "./UsePlanSheet";

/** The sheet on screen, if any: one at a time. */
export type OpenSheet =
	| { kind: "envelope"; id: string; mode: EnvelopeMode }
	| { kind: "usePlan" }
	| { kind: "takeBack" }
	| { kind: "afford" }
	| { kind: "newEnvelope" }
	| { kind: "merge" }
	| { kind: "style" }
	| { kind: "payDebt" }
	| { kind: "reconcile" };

/** Every sheet the Budget tab can present, closed unless `sheet` names it. */
export function BudgetSheets({
	data,
	kind,
	sheet,
	onClose,
	onDone,
	onOpen,
}: {
	data: BudgetMonth;
	kind: MonthKind;
	sheet: OpenSheet | null;
	onClose: () => void;
	onDone: () => void;
	onOpen: (sheet: OpenSheet) => void;
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
			<AffordSheet
				data={data}
				onClose={onClose}
				onMove={(id) => onOpen({ kind: "envelope", id, mode: "move" })}
				visible={sheet?.kind === "afford"}
			/>
			<NewEnvelopeSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={sheet?.kind === "newEnvelope"}
			/>
			<MergeSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={sheet?.kind === "merge"}
			/>
			<PayDebtSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={sheet?.kind === "payDebt"}
			/>
			<ReconcileSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={sheet?.kind === "reconcile"}
			/>
			<StyleSheet
				data={data}
				onClose={onClose}
				onDone={onDone}
				visible={sheet?.kind === "style"}
			/>
		</>
	);
}
