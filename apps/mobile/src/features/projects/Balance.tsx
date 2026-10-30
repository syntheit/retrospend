import type { Money } from "@retrospend/domain/money-minor";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { MoneyAmount } from "@/ui/Money";
import { Text } from "@/ui/Text";
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
	const { space } = useTheme();
	const { owedToYou, youOwe } = balanceSides(lines);
	if (owedToYou.length === 0 && youOwe.length === 0) {
		return (
			<Text tone="fg2" variant="small">
				{t("settled")}
			</Text>
		);
	}
	return (
		<View style={{ alignItems: "flex-end", gap: space[1] }}>
			{owedToYou.map((line) => (
				<View key={`in:${line.currency}`} style={{ alignItems: "flex-end" }}>
					<Text tone="fg2" variant="small">
						{t("owesYou")}
					</Text>
					<MoneyAmount tone="positive" value={line} />
				</View>
			))}
			{youOwe.map((line) => (
				<View key={`out:${line.currency}`} style={{ alignItems: "flex-end" }}>
					<Text tone="fg2" variant="small">
						{t("youOwe")}
					</Text>
					<MoneyAmount value={line} />
				</View>
			))}
		</View>
	);
}
