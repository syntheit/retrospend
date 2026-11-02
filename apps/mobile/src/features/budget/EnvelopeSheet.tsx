import { type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { SheetBody } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { Sheet, type SheetDetent, useSheetBodySize } from "@/ui/Sheet";
import { AssignForm } from "./AssignForm";
import { CoverForm } from "./CoverForm";
import { EditForm } from "./EditForm";
import { EnvelopeOverview } from "./EnvelopeOverview";
import { LimitForm } from "./LimitForm";
import { MoveForm } from "./MoveForm";
import type { MonthKind } from "./months";
import type { BudgetEnvelope, BudgetMonth } from "./source";
import { TargetForm } from "./TargetForm";

export type EnvelopeMode =
	| "overview"
	| "assign"
	| "move"
	| "cover"
	| "limit"
	| "target"
	| "edit";

/**
 * How tall each part of the envelope sheet rests: the overview and the
 * one-amount forms are short tasks, the keypad form and the long forms are
 * large. A short mode can still be pulled up when its body is taller than
 * the sheet.
 */
const MODE_DETENTS: Record<EnvelopeMode, SheetDetent[]> = {
	overview: ["medium", "large"],
	cover: ["medium", "large"],
	limit: ["medium", "large"],
	move: ["large"],
	assign: ["large"],
	target: ["large"],
	edit: ["large"],
};

/**
 * One envelope's sheet: the overview (EnvelopeOverview), and the forms
 * (assign, move, cover, limit, target, edit) opening inside the same sheet,
 * so a second sheet never has to present while the first is leaving.
 */
export function EnvelopeSheet({
	data,
	envelope,
	month,
	kind,
	startMode,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	/** Null: the sheet is closed. */
	envelope: BudgetEnvelope | null;
	month: number;
	kind: MonthKind;
	startMode: EnvelopeMode;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.envelope");
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const moveSize = useSheetBodySize();
	const [mode, setMode] = useState<EnvelopeMode>(startMode);
	const id = envelope?.id ?? null;

	// Each opening starts where the caller said (a verdict button jumps to Cover).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `id` is the opening
	useEffect(() => setMode(startMode), [id, startMode]);

	const title =
		envelope === null
			? undefined
			: mode === "overview"
				? envelope.name
				: t(`${mode}Title`, { name: envelope.name });

	const form = (child: (e: BudgetEnvelope) => ReactNode) =>
		envelope ? <View style={{ gap: space[3] }}>{child(envelope)}</View> : null;
	const props = (e: BudgetEnvelope) => ({
		data,
		envelope: e,
		month,
		onClose,
		onDone,
	});

	return (
		<Sheet
			backLabel={tc("back")}
			detents={MODE_DETENTS[mode]}
			onBack={
				mode === "overview" || envelope === null
					? undefined
					: () => setMode("overview")
			}
			// Edit is the pencil in the header; the overview shows facts (R2, R3).
			edit={
				mode === "overview" && envelope !== null && kind !== "closed"
					? { label: tc("edit"), onPress: () => setMode("edit") }
					: undefined
			}
			onClose={onClose}
			title={title}
			visible={envelope !== null}
		>
			{mode === "move" ? (
				// The keypad form runs its own scroll and foot, like the composer.
				<View style={moveSize}>
					{envelope ? <MoveForm {...props(envelope)} /> : null}
				</View>
			) : (
				<SheetBody>
					{mode === "assign"
						? form((e) => <AssignForm {...props(e)} />)
						: mode === "cover"
							? form((e) => <CoverForm {...props(e)} />)
							: mode === "limit"
								? form((e) => <LimitForm {...props(e)} />)
								: mode === "target"
									? form((e) => <TargetForm {...props(e)} />)
									: mode === "edit"
										? form((e) => <EditForm {...props(e)} />)
										: envelope
											? (
													<EnvelopeOverview
														data={data}
														envelope={envelope}
														kind={kind}
														onMode={setMode}
													/>
												)
											: null}
				</SheetBody>
			)}
		</Sheet>
	);
}
