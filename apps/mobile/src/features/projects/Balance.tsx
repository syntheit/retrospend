import type { Money } from "@retrospend/domain/money-minor";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { balanceSides } from "./source";

/**
 * What a balance says out loud: "Group owes you ARS 1,000, you owe BRL 20".
 * One phrase per currency, never netted.
 */
export function useBalanceWords() {
	const t = useTranslations("mobile.projects");
	const money = useMoneyText();
	return (lines: Money[]): string => {
		const { owedToYou, youOwe } = balanceSides(lines);
		const parts = [
			...owedToYou.map((l) => t("owesYouAmount", { amount: money(l) })),
			...youOwe.map((l) => t("youOweAmount", { amount: money(l) })),
		];
		return parts.length > 0 ? parts.join(", ") : t("settled");
	};
}

/**
 * Your balance in one project as a column: a small side word over the
 * amount, one pair per currency, or "Settled". Money right-aligns on one
 * edge with tabular figures.
 */
export function BalanceColumn({ lines }: { lines: Money[] }) {
	const t = useTranslations("mobile.projects");
	const { color, type } = useTheme();
	const { owedToYou, youOwe } = balanceSides(lines);
	if (owedToYou.length === 0 && youOwe.length === 0) {
		return (
			<Text style={{ color: color.fg2, fontSize: type.small.size }}>
				{t("settled")}
			</Text>
		);
	}
	return (
		<View style={{ alignItems: "flex-end", gap: 2 }}>
			{owedToYou.map((line) => (
				<View key={`in:${line.currency}`} style={{ alignItems: "flex-end" }}>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("owesYou")}
					</Text>
					<MoneyAmount tone="positive" value={line} />
				</View>
			))}
			{youOwe.map((line) => (
				<View key={`out:${line.currency}`} style={{ alignItems: "flex-end" }}>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("youOwe")}
					</Text>
					<MoneyAmount value={line} />
				</View>
			))}
		</View>
	);
}
