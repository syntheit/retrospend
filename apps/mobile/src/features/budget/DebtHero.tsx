import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Hero } from "@/ui/Hero";
import { Text } from "@/ui/Text";
import { monthDate } from "./months";
import type { BudgetMonth, PayoffProjection } from "./source";

/**
 * Pay off debt: the hero is the debt-free month, with the total debt under it
 * (SPEC 4.2, 6.1). Every figure is the server's projection at today's rates;
 * a debt with no rate is left out and named, never counted as 1. Left to
 * spend stays one quiet line: it is still the month's number.
 */
export function DebtHero({
	data,
	payoff,
}: {
	data: BudgetMonth;
	/** Null when the projection did not load. */
	payoff: PayoffProjection | null;
}) {
	const t = useTranslations("mobile.budget.debt");
	const format = useFormatter();
	const money = useMoneyText();
	const { space } = useTheme();
	const lead = data.verdict.lead.amount;
	const quiet = t("leftToSpend", {
		amount: money(lead, lead.minor < 0 ? { sign: "never" } : undefined),
	});
	if (!payoff) {
		return (
			<View style={{ gap: space[1], paddingHorizontal: space[4] }}>
				<Text tone="fg2">{t("unavailable")}</Text>
				<Text tone="fg2" variant="small">
					{quiet}
				</Text>
			</View>
		);
	}
	const missing = [...new Set(payoff.missingRates.map((m) => m.currency))];
	const headline = payoff.debtFreeMonth
		? format.dateTime(monthDate(payoff.debtFreeMonth), {
				month: "long",
				year: "numeric",
				timeZone: "UTC",
			})
		: payoff.diverges
			? t("neverAtPayment")
			: t("never");
	const sentence = payoff.diverges
		? t("diverges")
		: payoff.incomplete
			? t("incomplete", { currencies: missing.join(", ") })
			: t("sentence", {
					total: money(payoff.totalDebt),
					count: payoff.debts.length,
					months: payoff.months,
				});
	return (
		<View style={{ gap: space[3], paddingHorizontal: space[4] }}>
			<Hero
				label={t("label")}
				sub={
					<View style={{ gap: space[1] }}>
						<Text>{sentence}</Text>
						{payoff.capped && !payoff.incomplete && !payoff.diverges ? (
							<Text>{t("capped")}</Text>
						) : null}
					</View>
				}
				value={headline}
			/>
			<Text tone="fg2" variant="small">
				{quiet}
			</Text>
		</View>
	);
}
