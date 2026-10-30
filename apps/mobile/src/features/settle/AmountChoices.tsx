import { View } from "react-native";
import { useTranslations } from "use-intl";
import type { SettleContext } from "@/features/people/source";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { type AmountChoice, type Direction, everythingConverts } from "./plan";

/**
 * What the payment pays, as chips that carry their amounts: Everything, and
 * one currency's part when more than one is owed. A chip fills the amount
 * field above it; typing there picks none. The amounts are the server's own
 * fills, the same ones Record then pays; a conversion into the payment
 * currency reads "≈".
 */
export function AmountChoices({
	context,
	direction,
	choice,
	onChoose,
}: {
	context: SettleContext;
	direction: Direction;
	choice: AmountChoice;
	onChoose: (choice: AmountChoice) => void;
}) {
	const t = useTranslations("mobile.settle");
	const tm = useTranslations("mobile.money");
	const money = useMoneyText();
	const { space } = useTheme();
	const approx = (amount: string, estimate: boolean) =>
		estimate ? tm("approx", { amount }) : amount;
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
				{context.everything ? (
					<Chip
						label={t("everythingAmount", {
							amount: approx(
								money(context.everything),
								everythingConverts(context, direction),
							),
						})}
						onPress={() => onChoose({ kind: "everything" })}
						selected={choice.kind === "everything"}
					/>
				) : null}
				{context.parts.map((part) => (
					<Chip
						key={part.currency}
						label={t("partAmount", {
							currency: part.currency,
							amount: approx(
								money(part.full),
								part.currency !== context.currency,
							),
						})}
						onPress={() => onChoose({ kind: "part", currency: part.currency })}
						selected={
							choice.kind === "part" && choice.currency === part.currency
						}
					/>
				))}
		</View>
	);
}
