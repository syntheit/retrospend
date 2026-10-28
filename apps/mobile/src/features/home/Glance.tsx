import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useVerdictText } from "@/features/budget/useVerdictText";
import { verdictLabel, verdictSentence } from "@/features/budget/verdict";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { wealthHref } from "@/features/wealth/routes";
import { useTheme } from "@/theme";
import { type Glance as GlanceData, heroOf } from "./source";

/** Home names no envelopes: the over verdicts it words never list any. */
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** A figure the server could not compute reads as words, never as 0 or 1. */
function Figure({
	label,
	value,
	caption,
	tone,
	approx,
	onPress,
}: {
	label: string;
	value: GlanceData["owedToYou"]["value"];
	caption?: string;
	tone?: "positive" | "default";
	/** A total converted at reference rates. */
	approx?: boolean;
	onPress?: () => void;
}) {
	const t = useTranslations("mobile.money");
	const format = useMoneyText();
	const { color, type } = useTheme();
	const spoken = [
		label,
		caption,
		value
			? approx
				? t("approx", { amount: format(value) })
				: format(value)
			: t("noRate"),
	]
		.filter(Boolean)
		.join(", ");
	return (
		<ListRow accessibilityLabel={spoken} onPress={onPress}>
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
				<MoneyAmount approx={approx} tone={tone} value={value} />
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
export function Glance({
	glance,
	approx,
}: {
	glance: GlanceData;
	approx: { owedToYou: boolean; youOwe: boolean };
}) {
	const t = useTranslations("mobile.home");
	const format = useMoneyText();
	const { color, space, type } = useTheme();
	const hero = heroOf(glance);
	const verdictText = useVerdictText(NO_NAMES);
	const noRate = useTranslations("mobile.money")("noRate");
	// Over budget reads as the Budget page does: "Over budget", how far, and why.
	const heroTitle =
		hero.kind === "over"
			? verdictText(
					verdictLabel(hero.verdict, hero.verdict.style === "SAVE_FIRST"),
				)
			: hero.kind === "left"
				? t("leftToSpend")
				: t("spentThisMonth");
	const opensBudget = hero.kind === "left" || hero.kind === "over";

	const sub =
		hero.kind === "over"
			? [verdictText(verdictSentence(hero.verdict))]
			: hero.kind === "left"
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

	// Left to spend is the budget's own number, so a tap on it opens Budget.
	const heroLabel = [
		heroTitle,
		hero.amount
			? format(
					hero.amount,
					hero.kind === "over" ? { sign: "never" } : undefined,
				)
			: noRate,
		...sub,
	].join(", ");

	return (
		<View>
			<Pressable
				accessibilityLabel={opensBudget ? heroLabel : undefined}
				accessibilityRole={opensBudget ? "button" : undefined}
				accessible={opensBudget ? true : undefined}
				disabled={!opensBudget}
				onPress={() => router.navigate("/budget")}
				style={{ gap: space[1], padding: space[4] }}
			>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{heroTitle}
				</Text>
				{hero.kind === "over" ? (
					<Text
						style={{
							color: color.fg,
							fontSize: type.hero.size,
							fontVariant: ["tabular-nums"],
							fontWeight: "600",
						}}
					>
						{format(hero.amount, { sign: "never" })}
					</Text>
				) : hero.amount ? (
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
			</Pressable>
			<Figure
				approx={approx.owedToYou}
				label={t("owedToYou")}
				onPress={() =>
					router.navigate({
						pathname: "/people",
						params: { segment: "people" },
					})
				}
				tone="positive"
				value={glance.owedToYou.value}
			/>
			<Figure
				approx={approx.youOwe}
				label={t("youOwe")}
				onPress={() =>
					router.navigate({
						pathname: "/people",
						params: { segment: "people" },
					})
				}
				value={glance.youOwe.value}
			/>
			<Figure
				label={t("netWorth")}
				onPress={() => router.push(wealthHref("home"))}
				value={glance.netWorth.value}
			/>
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
