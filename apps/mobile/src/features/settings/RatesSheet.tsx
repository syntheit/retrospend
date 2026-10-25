import { ScrollView, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import type { FavoriteRate } from "./source";

/**
 * The exchange rates pinned for quick picking. A rate is a quote against
 * the dollar as the server stored it (nothing is computed here); Unpin
 * only drops the pin, so it is not a money action and has no preview.
 */
export function RatesSheet({
	rates,
	visible,
	onClose,
	onChanged,
}: {
	rates: FavoriteRate[];
	visible: boolean;
	onClose: () => void;
	onChanged: () => void;
}) {
	const t = useTranslations("mobile.settings.rates");
	const { api } = useSession();
	const toast = useToast();
	const { color, space, type } = useTheme();

	async function unpin(rate: FavoriteRate) {
		if (!api) return;
		try {
			await api.settings.removeFavoriteRate(
				{ exchangeRateId: rate.exchangeRateId },
				{ context: { idempotencyKey: newClientId() } },
			);
			onChanged();
			toast.show({ message: t("unpinned") });
		} catch {
			toast.show({ message: t("error") });
		}
	}

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[3], paddingBottom: space[4] }}
			>
				{rates.length === 0 ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{t("none")}
					</Text>
				) : (
					rates.map((item) => (
						<View
							key={item.exchangeRateId}
							style={{
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
								gap: space[3],
							}}
						>
							<View
								accessibilityLabel={t("spoken", {
									currency: item.rate.currency,
									type: item.rate.type,
									rate: item.rate.unitsPerUsd,
								})}
								accessible
								style={{ flex: 1, gap: 2 }}
							>
								<Text
									style={{
										color: color.fg,
										fontSize: type.body.size,
										fontWeight: "500",
									}}
								>
									{`${item.rate.currency} ${item.rate.type}`}
								</Text>
								<Text
									style={{
										color: color.fg2,
										fontSize: type.small.size,
										fontVariant: ["tabular-nums"],
									}}
								>
									{t("line", {
										rate: item.rate.unitsPerUsd,
										currency: item.rate.currency,
									})}
								</Text>
							</View>
							<Button
								label={t("unpin")}
								onPress={() => unpin(item)}
								variant="outlined"
							/>
						</View>
					))
				)}
			</ScrollView>
		</Sheet>
	);
}
