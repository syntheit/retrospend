import { type EnvelopeMode, EnvelopeSheet } from "./EnvelopeSheet";
import type { MoreKind } from "./MoreSheets";
import type { MonthKind } from "./months";
import { SHEET_KINDS, SHEETS } from "./sheetRegistry";
import { type BudgetMonth, envelopeById } from "./source";

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
	| { kind: "reconcile" }
	| { kind: MoreKind };

/**
 * Every sheet the Budget tab can present, closed unless `sheet` names it. An
 * envelope's sheet has modes of its own; every other kind is one entry of the
 * registry, which also says how tall it rests.
 */
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
			{SHEET_KINDS.map((name) => {
				const { component: Sheet, detent } = SHEETS[name];
				return (
					<Sheet
						data={data}
						detent={detent}
						key={name}
						kind={kind}
						onClose={onClose}
						onDone={onDone}
						onOpen={onOpen}
						visible={sheet?.kind === name}
					/>
				);
			})}
		</>
	);
}
