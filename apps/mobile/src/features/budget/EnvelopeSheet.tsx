import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { LinkButton } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { AssignForm } from "./AssignForm";
import { CoverForm } from "./CoverForm";
import { LimitForm } from "./LimitForm";
import { MoveForm } from "./MoveForm";
import type { MonthKind } from "./months";
import { Line, Note } from "./parts";
import { envelopeActions, isLimits, statusLine } from "./rows";
import type { BudgetEnvelope, BudgetMonth } from "./source";

export type EnvelopeMode = "overview" | "assign" | "move" | "cover" | "limit";

/**
 * One envelope's sheet: its numbers and what can be done to it. The forms
 * (assign, move, cover, limit) open inside the same sheet, so a second sheet
 * never has to present while the first is still leaving.
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
	const tb = useTranslations("mobile.budget");
	const money = useMoneyText();
	const { space } = useTheme();
	const [mode, setMode] = useState<EnvelopeMode>(startMode);
	const id = envelope?.id ?? null;

	// Each opening starts where the caller said (a verdict button jumps to Cover).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `id` is the opening
	useEffect(() => setMode(startMode), [id, startMode]);

	const style = data.book.style;
	const limits = isLimits(style);
	const actions = envelope ? envelopeActions(envelope, style, kind) : null;
	const status = envelope ? statusLine(envelope) : null;

	const title =
		envelope === null
			? undefined
			: mode === "overview"
				? envelope.name
				: t(`${mode}Title`, { name: envelope.name });

	const form = (child: (e: BudgetEnvelope) => React.ReactNode) =>
		envelope ? (
			<View style={{ gap: space[3] }}>
				{/* The link pads itself to a row's gutter; the sheet already has one. */}
				<View style={{ alignItems: "flex-start", marginLeft: -space[4] }}>
					<LinkButton label={t("back")} onPress={() => setMode("overview")} />
				</View>
				{child(envelope)}
			</View>
		) : null;
	const props = (e: BudgetEnvelope) => ({
		data,
		envelope: e,
		month,
		onClose,
		onDone,
	});

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={title}
			visible={envelope !== null}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
			>
				{mode === "assign" ? (
					form((e) => <AssignForm {...props(e)} />)
				) : mode === "move" ? (
					form((e) => <MoveForm {...props(e)} />)
				) : mode === "cover" ? (
					form((e) => <CoverForm {...props(e)} />)
				) : mode === "limit" ? (
					form((e) => <LimitForm {...props(e)} />)
				) : envelope && actions ? (
					<>
						<View>
							<Line
								label={limits ? t("limit") : t("assigned")}
								value={money(envelope.assigned)}
							/>
							<Line label={t("spent")} value={money(envelope.spent)} />
							<Line emphasis label={t("left")} value={money(envelope.left)} />
						</View>
						{status ? (
							<Note tone={status.kind === "over" ? "attention" : "plain"}>
								{status.kind === "over"
									? tb("row.over", {
											amount: money(status.amount, { sign: "never" }),
										})
									: status.kind === "needs"
										? tb("row.needs", { amount: money(status.amount) })
										: status.kind === "funded"
											? tb("row.funded")
											: tb("row.noRate", { currency: status.currency })}
							</Note>
						) : null}
						{kind === "closed" ? <Note>{t("closedHint")}</Note> : null}
						{actions.cover ? (
							<Button label={t("cover")} onPress={() => setMode("cover")} />
						) : null}
						{actions.limit ? (
							<Button
								label={
									envelope.status === "OVERSPENT"
										? tb("verdict.action.raiseLimit")
										: t("limitAction")
								}
								onPress={() => setMode("limit")}
							/>
						) : null}
						{actions.assign ? (
							<Button
								label={t("assign")}
								onPress={() => setMode("assign")}
								variant={actions.cover ? "outlined" : "filled"}
							/>
						) : null}
						{actions.move ? (
							<Button
								label={t("move")}
								onPress={() => setMode("move")}
								variant="outlined"
							/>
						) : null}
					</>
				) : null}
			</ScrollView>
		</Sheet>
	);
}
