import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { CategoryTile } from "@/ui/List";
import { Text } from "@/ui/Text";
import { rowTitle } from "./ActivityRow";
import type { ActivityItem } from "./source";

/**
 * The top of an entry (the mockup's): the category tile, the title (16/600),
 * the amount as entered (22/600) and, for a foreign one, "≈ home" under it in
 * 12 fg-3. A foreign amount without a rate says so in words, never as 1 or 0.
 */
export function EntryHead({ item }: { item: ActivityItem }) {
	const ta = useTranslations("mobile.activity");
	const tm = useTranslations("mobile.money");
	const { space } = useTheme();
	const money = useMoneyText();
	const { format, pair } = useFormatMoney();
	const income = item.kind === "income" || item.kind === "refund";
	const sign = income ? "exceptZero" : "auto";
	const foreign =
		item.home !== undefined && item.home?.currency !== item.amount.currency;
	const second = !foreign
		? null
		: item.home
			? tm("approx", { amount: money(item.home) })
			: tm("noRate");
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				paddingVertical: space[2],
			}}
		>
			<CategoryTile
				category={item.category}
				fallback={item.kind === "payment" ? "Banknote" : "Tag"}
			/>
			<View style={{ flex: 1 }}>
				<Text accessibilityRole="header" numberOfLines={2} variant="section">
					{rowTitle(item, ta)}
				</Text>
				<Text tabular tone={income ? "positive" : "fg"} variant="title">
					{(item.home === undefined
						? format(item.amount, { sign })
						: pair(item.amount, item.home, { sign }).original) ?? ""}
				</Text>
				{second ? (
					<Text tabular tone="fg3" variant="meta">
						{second}
					</Text>
				) : null}
			</View>
		</View>
	);
}
