import { categoryIconName } from "@retrospend/domain/category-icons";
import { type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note, SheetBody } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { IconTile } from "@/ui/IconTile";
import { Menu } from "@/ui/Menu";
import { ProgressBar } from "@/ui/ProgressBar";
import { Sheet, type SheetDetent, useSheetBodySize } from "@/ui/Sheet";
import { StatusText, type StatusTone } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { AssignForm } from "./AssignForm";
import { CoverForm } from "./CoverForm";
import { EditForm } from "./EditForm";
import { LimitForm } from "./LimitForm";
import { MoveForm } from "./MoveForm";
import type { MonthKind } from "./months";
import { envelopeActions, isLimits, type StatusLine, statusLine } from "./rows";
import type { BudgetEnvelope, BudgetMonth } from "./source";
import { TargetForm } from "./TargetForm";
import { useTargetText } from "./useTargetText";

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

/** The tone of the status word under the tile; the word itself is the server's status in words. */
function statusTone(line: StatusLine): StatusTone {
	switch (line.kind) {
		case "over":
		case "needs":
		case "noRate":
			return "attention";
		case "funded":
			return "positive";
		case "week":
			return "quiet";
	}
}

/** One of the three figures under the bar: a quiet label over the amount, 600. */
function Figure({
	label,
	value,
	tone = "fg",
}: {
	label: string;
	value: string;
	tone?: "fg" | "attention";
}) {
	return (
		<View
			accessibilityLabel={`${label}, ${value}`}
			accessible
			style={{ flex: 1, minWidth: 0 }}
		>
			<Text numberOfLines={1} tone="fg3" variant="meta">
				{label}
			</Text>
			<Text
				adjustsFontSizeToFit
				numberOfLines={1}
				tabular
				tone={tone}
				weight="semibold"
			>
				{value}
			</Text>
		</View>
	);
}

/**
 * One envelope's sheet: a tile, its bar and its numbers, one main action
 * chosen by its status, the other actions in a row, and the rest in a menu.
 * The forms (assign, move, cover, limit, target, edit) open inside the same
 * sheet, so a second sheet never has to present while the first is leaving.
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
	const tb = useTranslations("mobile.budget");
	const money = useMoneyText();
	const targetText = useTargetText();
	const { space } = useTheme();
	const moveSize = useSheetBodySize();
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

	const form = (child: (e: BudgetEnvelope) => ReactNode) =>
		envelope ? <View style={{ gap: space[3] }}>{child(envelope)}</View> : null;
	const props = (e: BudgetEnvelope) => ({
		data,
		envelope: e,
		month,
		onClose,
		onDone,
	});

	const statusWords = (line: StatusLine): string => {
		switch (line.kind) {
			case "over":
				return tb("row.over");
			case "needs":
				return tb("row.needs", { amount: money(line.amount) });
			case "week":
				return tb("row.leftThisWeek", { amount: money(line.amount) });
			case "funded":
				return tb("row.funded");
			case "noRate":
				return tb("row.noRate", { currency: line.currency });
		}
	};

	const overview = (e: BudgetEnvelope, a: NonNullable<typeof actions>) => {
		const overspent = e.status === "OVERSPENT";
		// One main action by status: cover what is over, else set the limit
		// (Limits books), else put money in.
		const primary: "cover" | "limit" | "assign" | null = a.cover
			? "cover"
			: a.limit
				? "limit"
				: a.assign
					? "assign"
					: null;
		const labels = {
			cover: t("cover"),
			limit: overspent ? tb("verdict.action.raiseLimit") : t("limitAction"),
			assign: t("assign"),
			move: t("move"),
		};
		const target = targetText(e, limits);
		const secondary: ("assign" | "move")[] = [];
		if (a.assign && primary !== "assign") secondary.push("assign");
		if (a.move) secondary.push("move");
		const more = [
			...(kind !== "closed" && !limits
				? [
						{
							id: "target",
							label: t("targetAction"),
							onPress: () => setMode("target"),
						},
					]
				: []),
		];
		return (
			<>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}
				>
					<IconTile name={categoryIconName(e.name, e.icon)} />
					<View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
						{status ? (
							<StatusText
								label={statusWords(status)}
								tone={statusTone(status)}
							/>
						) : null}
						{target ? (
							<Text
								numberOfLines={2}
								tone={target.attention ? "attention" : "fg2"}
								variant="small"
							>
								{target.text}
							</Text>
						) : null}
					</View>
					{more.length > 0 ? (
						<Menu
							accessibilityLabel={t("more")}
							icon
							items={more}
							label={t("more")}
						/>
					) : null}
				</View>
				{e.spentBasis !== null ? (
					<ProgressBar
						over={overspent}
						percent={e.spentBasis / 100}
						weight="regular"
					/>
				) : null}
				<View style={{ flexDirection: "row", gap: space[2] }}>
					<Figure
						label={limits ? t("limit") : t("assigned")}
						value={money(e.assigned)}
					/>
					<Figure label={t("spent")} value={money(e.spent)} />
					<Figure
						label={t("left")}
						tone={e.left.minor < 0 ? "attention" : "fg"}
						value={money(e.left)}
					/>
				</View>
				{kind === "closed" ? <Note>{t("closedHint")}</Note> : null}
				{primary ? (
					<Button
						label={labels[primary]}
						onPress={() => setMode(primary)}
						variant="filled"
					/>
				) : null}
				{secondary.length > 0 ? (
					<View
						style={{
							flexDirection: "row",
							flexWrap: "wrap",
							alignItems: "center",
							gap: space[2],
						}}
					>
						{secondary.map((m) => (
							<Button
								key={m}
								label={labels[m]}
								onPress={() => setMode(m)}
								variant="outlined"
							/>
						))}
					</View>
				) : null}
			</>
		);
	};

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
										: envelope && actions
											? overview(envelope, actions)
											: null}
				</SheetBody>
			)}
		</Sheet>
	);
}
