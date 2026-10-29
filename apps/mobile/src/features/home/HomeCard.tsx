import { View } from "react-native";
import { useTranslations } from "use-intl";
import { heroCents } from "@/features/read/MoneyAmount";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Hero } from "@/ui/Hero";
import { Text } from "@/ui/Text";
import { useHomeDates } from "./dates";
import { type Glance, spentOf } from "./source";

/**
 * Home's hero card, led as the web glance leads: Spent in the month, the one
 * big number, with the server's pace against last month by this day (or last
 * month's spend to date while there is no pace). Budget status is its own
 * card under it. A missing rate says "No rate yet", never a guess. Every
 * number is the server's figure.
 */
export function HomeCard({ glance }: { glance: Glance }) {
	const t = useTranslations("mobile.home.card");
	const noRate = useTranslations("mobile.money")("noRate");
	const format = useMoneyText();
	const dates = useHomeDates();
	const { color, radius, space } = useTheme();
	const spent = spentOf(glance);
	const last = dates.month(spent.lastMonth);
	const sub =
		spent.fasterThanLast !== null
			? t(spent.fasterThanLast ? "paceFaster" : "paceSlower", { month: last })
			: spent.lastToDate
				? t("lastMonth", { amount: format(spent.lastToDate) })
				: undefined;

	return (
		<View
			style={{
				padding: space[4],
				gap: space[2],
				backgroundColor: color.surface,
				borderWidth: 1,
				borderColor: color.line,
				borderRadius: radius.panel,
			}}
		>
			<Hero
				label={t("spentIn", { month: dates.month(glance.period.from) })}
				sub={sub}
				value={
					spent.amount
						? format(spent.amount, { cents: heroCents(spent.amount.currency) })
						: noRate
				}
			/>
			{glance.missingRates.length > 0 ? (
				<Text tone="attention" variant="meta">
					{t("missingRates", { currencies: glance.missingRates.join(", ") })}
				</Text>
			) : null}
		</View>
	);
}
