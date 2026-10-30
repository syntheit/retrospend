import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Hero } from "@/ui/Hero";
import { heroCents } from "@/ui/Money";
import { Text } from "@/ui/Text";
import type { InsightsSummary } from "./source";
import type { InsightsWords } from "./useInsightsWords";

/**
 * The one number of the screen and the lines under it: what you spent and on
 * what, how many expenses, the period before with Compare on (its amount and
 * the server's change) and which currencies a missing rate keeps out.
 */
export function SummaryLead({
	summary,
	allTime,
	names,
	words,
}: {
	summary: InsightsSummary;
	allTime: boolean;
	/** The chips' picks by name, joined: "Groceries, Martín". */
	names: string;
	words: InsightsWords;
}) {
	const t = useTranslations("mobile.insights");
	const noRate = useTranslations("mobile.money")("noRate");
	const money = useMoneyText();
	const { space } = useTheme();
	const range = words.range(summary.range);
	const lead = allTime
		? names
			? t("leadAllOn", { names })
			: t("leadAll")
		: names
			? t("leadOn", { names, range })
			: t("lead", { range });
	const { previousTotal, previousRange } = summary;
	const before =
		previousTotal?.value && previousRange
			? previousTotal.value.minor === 0
				? t("wasNone", { period: words.range(previousRange) })
				: summary.changePct === null
					? t("was", {
							period: words.range(previousRange),
							amount: money(previousTotal.value),
						})
					: t("wasChange", {
							period: words.range(previousRange),
							amount: money(previousTotal.value),
							change: words.change(summary.changePct),
						})
			: null;
	const count = t("count", { count: summary.count });
	const total = summary.total.value;

	return (
		<View style={{ gap: space[1], padding: space[4] }}>
			<Hero
				label={t("leadLine", { lead, count })}
				sub={before ?? undefined}
				value={
					total ? money(total, { cents: heroCents(total.currency) }) : noRate
				}
			/>
			{summary.missingRates.length > 0 ? (
				<Text tone="fg3" variant="small">
					{t("missingRates", { currencies: summary.missingRates.join(", ") })}
				</Text>
			) : null}
		</View>
	);
}
