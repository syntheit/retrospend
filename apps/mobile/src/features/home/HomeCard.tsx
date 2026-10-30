import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { Hero } from "@/ui/Hero";
import { heroCents, MoneyAmount } from "@/ui/Money";
import { Text } from "@/ui/Text";
import { useHomeDates } from "./dates";
import { type Glance, spentOf } from "./source";

/**
 * Home's hero card, led as the web glance leads: Spent in the month, the one
 * big number, with the server's pace against last month by this day (or last
 * month's spend to date while there is no pace). Budget status is its own
 * card under it. Without a budget the card takes the mockup's new-state form:
 * the wallet glyph and the month, the figure with "spent" after it. A missing
 * rate says "No rate yet", never a guess. Every number is the server's
 * figure. The card opens Insights, or Budget while there is no budget to see.
 */
export function HomeCard({ glance }: { glance: Glance }) {
	const t = useTranslations("mobile.home.card");
	const noRate = useTranslations("mobile.money")("noRate");
	const format = useMoneyText();
	const dates = useHomeDates();
	const { color, radius, size, space } = useTheme();
	const spent = spentOf(glance);
	const month = dates.month(glance.period.from);
	const last = dates.month(spent.lastMonth);
	const sub =
		spent.fasterThanLast !== null
			? t(spent.fasterThanLast ? "paceFaster" : "paceSlower", { month: last })
			: spent.lastToDate
				? t("lastMonth", { amount: format(spent.lastToDate) })
				: undefined;
	const noBudget = glance.budget?.state !== "ready";

	return (
		<Pressable
			accessibilityRole="button"
			onPress={() => router.push(noBudget ? "/budget" : "/home/insights")}
			style={({ pressed }) => ({
				padding: space[4],
				gap: space[2],
				backgroundColor: pressed ? color.raised : color.surface,
				borderWidth: 1,
				borderColor: color.line,
				borderRadius: radius.panel,
			})}
		>
			{noBudget ? (
				<>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[2],
						}}
					>
						<Glyph color={color.fg2} name="Wallet" size={size.icon.phone} />
						<Text
							numberOfLines={1}
							style={{ flex: 1 }}
							tone="fg2"
							variant="small"
						>
							{t("spentIn", { month })}
						</Text>
						<Glyph
							color={color.fg3}
							name="ChevronRight"
							size={size.icon.phone}
						/>
					</View>
					<View
						style={{
							flexDirection: "row",
							alignItems: "baseline",
							gap: space[2],
						}}
					>
						{spent.amount ? (
							<MoneyAmount align="left" size="hero" value={spent.amount} />
						) : (
							<Text variant="title">{noRate}</Text>
						)}
					</View>
					{sub ? (
						<Text tone="fg2" variant="small">
							{sub}
						</Text>
					) : null}
				</>
			) : (
				<>
					<Hero
						label={t("spentIn", { month })}
						sub={sub}
						value={
							spent.amount
								? format(spent.amount, {
										cents: heroCents(spent.amount.currency),
									})
								: noRate
						}
					/>
					<View
						style={{ position: "absolute", top: space[4], right: space[4] }}
					>
						<Glyph
							color={color.fg3}
							name="ChevronRight"
							size={size.icon.phone}
						/>
					</View>
				</>
			)}
			{glance.missingRates.length > 0 ? (
				<Text tone="attention" variant="meta">
					{t("missingRates", { currencies: glance.missingRates.join(", ") })}
				</Text>
			) : null}
		</Pressable>
	);
}
