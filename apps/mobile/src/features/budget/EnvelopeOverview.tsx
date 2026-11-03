import { categoryIconName } from "@retrospend/domain/category-icons";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { IconTile } from "@/ui/IconTile";
import { Menu } from "@/ui/Menu";
import { ProgressBar } from "@/ui/ProgressBar";
import { StatusText, type StatusTone } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import type { EnvelopeMode } from "./EnvelopeSheet";
import type { MonthKind } from "./months";
import { envelopeActions, isLimits, type StatusLine, statusLine } from "./rows";
import type { BudgetEnvelope, BudgetMonth } from "./source";
import { useTargetText } from "./useTargetText";

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
 * One envelope's facts and its actions: a tile, its bar and numbers, one main
 * action chosen by its status, the others in a row, the rest in a menu. Shared
 * by the envelope sheet (phones) and the Budget inspector (expanded tablets);
 * `onMode` opens one of the forms.
 */
export function EnvelopeOverview({
	data,
	envelope: e,
	kind,
	onMode,
}: {
	data: BudgetMonth;
	envelope: BudgetEnvelope;
	kind: MonthKind;
	onMode: (mode: EnvelopeMode) => void;
}) {
	const t = useTranslations("mobile.budget.envelope");
	const tb = useTranslations("mobile.budget");
	const money = useMoneyText();
	const targetText = useTargetText();
	const { space } = useTheme();
	const style = data.book.style;
	const limits = isLimits(style);
	const a = envelopeActions(e, style, kind);
	const status = statusLine(e);

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
						onPress: () => onMode("target"),
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
						<StatusText label={statusWords(status)} tone={statusTone(status)} />
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
					onPress={() => onMode(primary)}
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
							onPress={() => onMode(m)}
							variant="outlined"
						/>
					))}
				</View>
			) : null}
		</>
	);
}
