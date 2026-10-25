import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { isLimits, statusLine } from "./rows";
import type { BudgetEnvelope, BudgetStyle } from "./source";

/** The width of one money column on a wide screen, from the spacing scale. */
export function useColumnWidth(): number {
	const { space } = useTheme();
	return space[12] * 2 + space[4];
}

/** Words for the line under an envelope's name; the status is a word as well as a color. */
export function useStatusText() {
	const t = useTranslations("mobile.budget.row");
	const money = useMoneyText();
	return (e: BudgetEnvelope): { text: string; attention: boolean } | null => {
		const line = statusLine(e);
		if (!line) return null;
		switch (line.kind) {
			case "over":
				return {
					text: t("over", { amount: money(line.amount, { sign: "never" }) }),
					attention: true,
				};
			case "needs":
				return { text: t("needs", { amount: money(line.amount) }), attention: false };
			case "funded":
				return { text: t("funded"), attention: false };
			case "noRate":
				return {
					text: t("noRate", { currency: line.currency }),
					attention: true,
				};
		}
	};
}

/**
 * One envelope: its name, a status line, and Left. Phones show Left only
 * (the rest is in the envelope's sheet); a wide screen adds the Assigned (or
 * Limit) and Spent columns.
 */
export function EnvelopeRow({
	envelope,
	style,
	wide,
	onPress,
}: {
	envelope: BudgetEnvelope;
	style: BudgetStyle;
	wide: boolean;
	onPress: () => void;
}) {
	const t = useTranslations("mobile.budget.row");
	const money = useMoneyText();
	const statusText = useStatusText();
	const column = useColumnWidth();
	const { color, space, type } = useTheme();
	const status = statusText(envelope);
	const left = money(envelope.left);
	const spoken = [
		envelope.name,
		status?.text,
		t("leftSpoken", { amount: left }),
	]
		.filter(Boolean)
		.join(", ");
	const cell = (value: string, strong?: boolean) => (
		<Text
			numberOfLines={1}
			style={{
				width: column,
				color:
					strong && envelope.status === "OVERSPENT"
						? color.attentionText
						: color.fg,
				fontSize: type.body.size,
				fontVariant: ["tabular-nums"],
				fontWeight: strong ? "600" : "400",
				textAlign: "right",
			}}
		>
			{value}
		</Text>
	);

	return (
		<ListRow accessibilityLabel={spoken} onPress={onPress}>
			<View style={{ flex: 1, gap: space[1] }}>
				<Text
					numberOfLines={1}
					style={{ color: color.fg, fontSize: type.body.size }}
				>
					{envelope.name}
				</Text>
				{status ? (
					<Text
						numberOfLines={1}
						style={{
							color: status.attention ? color.attentionText : color.fg2,
							fontSize: type.small.size,
						}}
					>
						{status.text}
					</Text>
				) : null}
			</View>
			{wide ? (
				<>
					{cell(money(envelope.assigned))}
					{cell(money(envelope.spent))}
				</>
			) : null}
			{cell(left, true)}
		</ListRow>
	);
}

/** The column titles of a wide table: Assigned (Limit in Limits), Spent, Left. */
export function ColumnTitles({ style }: { style: BudgetStyle }) {
	const t = useTranslations("mobile.budget.column");
	const column = useColumnWidth();
	const { color, space, type } = useTheme();
	const title = (text: string) => (
		<Text
			style={{
				width: column,
				color: color.fg2,
				fontSize: type.small.size,
				textAlign: "right",
			}}
		>
			{text}
		</Text>
	);
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				flexDirection: "row",
				paddingHorizontal: space[4],
				paddingTop: space[4],
				gap: space[3],
			}}
		>
			<View style={{ flex: 1 }} />
			{title(isLimits(style) ? t("limit") : t("assigned"))}
			{title(t("spent"))}
			{title(t("left"))}
		</View>
	);
}
