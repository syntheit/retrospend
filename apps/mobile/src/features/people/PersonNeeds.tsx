import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { LinkButton, ListRow } from "@/features/read/parts";
import { useTheme } from "@/theme";
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
	const { color, type } = useTheme();
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
						<ListRow accessibilityLabel={message}>
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
							<LinkButton
								label={ts("confirm")}
								onPress={() => onConfirm(need)}
							/>
						) : null}
					</View>
				);
			})}
		</View>
	);
}
