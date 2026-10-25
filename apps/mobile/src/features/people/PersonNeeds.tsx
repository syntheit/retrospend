import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import type { NeedsItem, PersonPage } from "./source";

/**
 * What waits for you on this person. A payment they say they made has a
 * Confirm action (with its preview); a split to review is told, and is
 * answered where it was added.
 */
export function PersonNeeds({
	page,
	onConfirm,
}: {
	page: PersonPage;
	onConfirm: (need: Extract<NeedsItem, { kind: "confirmPayment" }>) => void;
}) {
	const t = useTranslations("mobile.home.needs");
	const ts = useTranslations("mobile.settle");
	const format = useMoneyText();
	const { color, space, type } = useTheme();
	const first = page.person.name.split(/\s+/)[0] ?? "";
	return (
		<View>
			{page.needs.map((need) => {
				const message =
					need.kind === "confirmPayment"
						? t("payment_confirm", { name: first })
						: t("split_review", { name: first, title: need.title });
				return (
					<View key={`${need.kind}:${need.id}`}>
						<ListRow accessibilityLabel={`${message}, ${format(need.amount)}`}>
							<Text
								style={{
									flex: 1,
									color: color.attentionText,
									fontSize: type.body.size,
									fontWeight: "500",
								}}
							>
								{message}
							</Text>
							<MoneyAmount value={need.amount} />
						</ListRow>
						{need.kind === "confirmPayment" ? (
							<View
								style={{
									alignItems: "flex-start",
									paddingHorizontal: space[4],
									paddingVertical: space[2],
								}}
							>
								<Button
									label={ts("confirm")}
									onPress={() => onConfirm(need)}
									variant="outlined"
								/>
							</View>
						) : null}
					</View>
				);
			})}
		</View>
	);
}
