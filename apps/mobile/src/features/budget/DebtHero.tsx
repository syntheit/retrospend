import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
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
	const { color, space, type } = useTheme();
	const lead = data.verdict.lead.amount;
	const quiet = t("leftToSpend", {
		amount: money(lead, lead.minor < 0 ? { sign: "never" } : undefined),
	});
	if (!payoff) {
		return (
			<View style={{ gap: space[1], paddingHorizontal: space[4] }}>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("unavailable")}
				</Text>
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
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
		<View style={{ gap: space[1], paddingHorizontal: space[4] }}>
			<View
				accessibilityLabel={`${t("label")}, ${headline}. ${sentence}`}
				accessible
				style={{ gap: space[1] }}
			>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("label")}
				</Text>
				<Text
					adjustsFontSizeToFit
					numberOfLines={1}
					style={{
						color: color.fg,
						fontSize: type.hero.size,
						fontWeight: "600",
					}}
				>
					{headline}
				</Text>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{sentence}
				</Text>
				{payoff.capped && !payoff.incomplete && !payoff.diverges ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{t("capped")}
					</Text>
				) : null}
			</View>
			<Text style={{ color: color.fg2, fontSize: type.small.size }}>
				{quiet}
			</Text>
		</View>
	);
}
