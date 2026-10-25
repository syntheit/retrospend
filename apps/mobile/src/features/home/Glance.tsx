import { router } from "expo-router";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { type Glance as GlanceData, heroOf } from "./source";

/** A figure the server could not compute reads as words, never as 0 or 1. */
function Figure({
	label,
	value,
	caption,
	tone,
	onPress,
}: {
	label: string;
	value: GlanceData["owedToYou"]["value"];
	caption?: string;
	tone?: "positive" | "default";
	onPress?: () => void;
}) {
	const t = useTranslations("mobile.money");
	const { color, type } = useTheme();
	return (
		<ListRow accessibilityLabel={label} onPress={onPress}>
			<View style={{ flex: 1 }}>
				<Text style={{ color: color.fg, fontSize: type.body.size }}>
					{label}
				</Text>
				{caption ? (
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{caption}
					</Text>
				) : null}
			</View>
			{value ? (
				<MoneyAmount tone={tone} value={value} />
			) : (
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("noRate")}
				</Text>
			)}
		</ListRow>
	);
}

/**
 * Home's glance: one big number (Left to spend with a budget, else Spent this
 * month), then Owed to you and You owe as separate lines (never netted),
 * Net worth and the dollar. Every number is the server's figure.
 */
export function Glance({ glance }: { glance: GlanceData }) {
	const t = useTranslations("mobile.home");
	const format = useMoneyText();
	const { color, space, type } = useTheme();
	const hero = heroOf(glance);
	const noRate = useTranslations("mobile.money")("noRate");

	const sub =
		hero.kind === "left"
			? [
					t("perDay", {
						amount: format(hero.perDay),
						days: hero.daysLeft,
					}),
					t("spentSoFar", { amount: format(hero.spent) }),
				]
			: hero.lastToDate
				? [t("lastMonth", { amount: format(hero.lastToDate) })]
				: [];

	return (
		<View>
			<View style={{ gap: space[1], padding: space[4] }}>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{hero.kind === "left" ? t("leftToSpend") : t("spentThisMonth")}
				</Text>
				{hero.amount ? (
					<MoneyAmount align="left" size="hero" value={hero.amount} />
				) : (
					<Text
						style={{
							color: color.fg,
							fontSize: type.hero.size,
							fontWeight: "600",
						}}
					>
						{noRate}
					</Text>
				)}
				{sub.map((line) => (
					<Text
						key={line}
						style={{ color: color.fg2, fontSize: type.body.size }}
					>
						{line}
					</Text>
				))}
				{glance.missingRates.length > 0 ? (
					<Text
						style={{ color: color.attentionText, fontSize: type.small.size }}
					>
						{t("missingRates", { currencies: glance.missingRates.join(", ") })}
					</Text>
				) : null}
			</View>
			<Figure
				label={t("owedToYou")}
				onPress={() => router.navigate("/people")}
				tone="positive"
				value={glance.owedToYou.value}
			/>
			<Figure
				label={t("youOwe")}
				onPress={() => router.navigate("/people")}
				value={glance.youOwe.value}
			/>
			<Figure label={t("netWorth")} value={glance.netWorth.value} />
			{glance.dollarToday ? (
				<Figure
					caption={
						glance.dollarToday.rateType
							? t("dollarRate", { rate: glance.dollarToday.rateType })
							: undefined
					}
					label={t("dollarToday")}
					value={glance.dollarToday.value}
				/>
			) : null}
		</View>
	);
}
