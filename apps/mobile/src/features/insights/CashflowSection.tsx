import { SMART_NO_DECIMAL_CURRENCIES } from "@retrospend/domain/currency-format";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { SectionHeader } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import type { InsightsCashflow } from "./source";
import type { InsightsWords } from "./useInsightsWords";

type Figure = InsightsCashflow["income"];

/** A label and the server's figure at the right edge, tabular; a missing rate says so. */
function FigureRow({
	label,
	sub,
	figure,
	whole,
}: {
	label: string;
	sub?: string;
	figure: Figure;
	/** An average is approximate: ARS and the like show whole units, as by default. */
	whole?: boolean;
}) {
	const noRate = useTranslations("mobile.money")("noRate");
	const money = useMoneyText();
	const { color, size, space, type } = useTheme();
	const value = figure.value;
	const text = value
		? money(
				value,
				whole && SMART_NO_DECIMAL_CURRENCIES.includes(value.currency)
					? { cents: false }
					: undefined,
			)
		: noRate;
	return (
		<View
			accessibilityLabel={[label, sub, text].filter(Boolean).join(", ")}
			accessible
			style={{
				minHeight: size.row.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				paddingHorizontal: space[4],
				paddingVertical: space[2],
				borderBottomWidth: 1,
				borderBottomColor: color.line,
			}}
		>
			<View style={{ flex: 1 }}>
				<Text style={{ color: color.fg, fontSize: type.body.size }}>
					{label}
				</Text>
				{sub ? (
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{sub}
					</Text>
				) : null}
			</View>
			<Text
				numberOfLines={1}
				style={{
					color: value ? color.fg : color.fg2,
					fontSize: type.body.size,
					fontVariant: ["tabular-nums"],
					fontWeight: value ? "600" : "400",
					textAlign: "right",
				}}
			>
				{text}
			</Text>
		</View>
	);
}

/**
 * Money in against money out for the range: income, what was saved (with
 * the share of income it is) and the two averages. Shown only with no chip
 * set, since income has no category.
 */
export function CashflowSection({
	data,
	named,
	words,
}: {
	data: InsightsCashflow;
	/** Currencies the lead already names (a fact appears once). */
	named: readonly string[];
	words: InsightsWords;
}) {
	const t = useTranslations("mobile.insights.cashflow");
	const ti = useTranslations("mobile.insights");
	const { color, space, type } = useTheme();
	const unnamed = data.missingRates.filter((c) => !named.includes(c));
	return (
		<View>
			<SectionHeader title={t("title")} />
			<FigureRow figure={data.income} label={t("income")} />
			<FigureRow
				figure={data.saved}
				label={t("saved")}
				sub={
					data.savingsRatePct === null
						? undefined
						: t("rate", { percent: words.percent(data.savingsRatePct) })
				}
			/>
			<FigureRow figure={data.dailyAverage} label={t("perDay")} whole />
			<FigureRow figure={data.monthlyAverage} label={t("perMonth")} whole />
			{unnamed.length > 0 ? (
				<Text
					style={{
						color: color.fg3,
						fontSize: type.small.size,
						paddingHorizontal: space[4],
						paddingTop: space[2],
					}}
				>
					{ti("missingRates", { currencies: unnamed.join(", ") })}
				</Text>
			) : null}
		</View>
	);
}
