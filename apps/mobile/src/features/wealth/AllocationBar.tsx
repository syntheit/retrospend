import { formatPercent } from "@retrospend/domain/format-percent";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { seriesColor, THIN } from "@/ui/charts/chartSpec";
import { Text } from "@/ui/Text";
import type { AccountGroup } from "./accounts";
import type { WealthSummary } from "./source";

/** The series dot of a group: its slot color, or a ring for liabilities (no slot). */
export function GroupDot({ series }: { series: number | null }) {
	const { color, space } = useTheme();
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: space[2],
				height: space[2],
				borderRadius: space[1],
				backgroundColor:
					series === null ? "transparent" : seriesColor(color, series),
				borderWidth: series === null ? 1 : 0,
				borderColor: color.fg3,
			}}
		/>
	);
}

/**
 * What you own by group: one bar split by the server's shares (largest
 * first, liabilities left out) and an inline legend of dot, name and share.
 * The bar only lays the shares out; the figures and the order are the
 * server's. A group's color says which group, here and in its list header.
 */
export function AllocationBar({
	items,
}: {
	items: WealthSummary["allocation"];
}) {
	const t = useTranslations("mobile.wealth");
	const money = useMoneyText();
	const locale = useMoneyLocale();
	const { color, radius, space } = useTheme();
	if (items.length === 0) return null;
	const name = (key: AccountGroup) => t(`groups.${key}`);
	const percent = (share: number) =>
		formatPercent(share, { locale, digits: 0 });
	const spoken = items
		.map(
			(item) =>
				`${name(item.key)} ${money(item.value)} (${percent(item.share)})`,
		)
		.join(", ");
	return (
		<View style={{ gap: space[2] }}>
			<Text tone="fg2" variant="small">
				{t("assetsByGroup")}
			</Text>
			<View
				accessibilityLabel={`${t("assetsByGroup")}: ${spoken}`}
				accessibilityRole="image"
				accessible
				style={{
					flexDirection: "row",
					height: THIN.allocation,
					gap: THIN.gap,
					borderRadius: radius.chip,
					overflow: "hidden",
				}}
			>
				{items.map((item) => (
					<View
						key={item.key}
						style={{
							flexGrow: item.share,
							flexBasis: 0,
							minWidth: space[1],
							backgroundColor: seriesColor(color, item.series),
						}}
					/>
				))}
			</View>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{
					flexDirection: "row",
					flexWrap: "wrap",
					columnGap: space[4],
					rowGap: space[1],
				}}
			>
				{items.map((item) => (
					<View
						key={item.key}
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[2],
						}}
					>
						<GroupDot series={item.series} />
						<Text tone="fg2" variant="small">
							{name(item.key)}
						</Text>
						<Text tabular tone="fg3" variant="meta">
							{percent(item.share)}
						</Text>
					</View>
				))}
			</View>
		</View>
	);
}
