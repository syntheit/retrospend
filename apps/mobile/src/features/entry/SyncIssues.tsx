import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { announceEntryChange } from "./events";
import { useParkedEntries } from "./parked";

/**
 * "Couldn't sync": entries the server refused, kept on the phone. Each has
 * Try again and Discard. Nothing shows when nothing is parked, so Home,
 * Activity and the composer can all put it at their top.
 */
export function SyncIssues({ padded }: { padded?: boolean }) {
	const t = useTranslations("mobile.composer");
	const { color, size, space } = useTheme();
	const { format } = useFormatMoney();
	const toast = useToast();
	const { entries, retry, discard } = useParkedEntries();
	if (entries.length === 0) return null;

	const action = {
		minHeight: size.touchMin.phone,
		justifyContent: "center",
		paddingHorizontal: space[3],
	} as const;

	return (
		<View
			style={{
				gap: space[2],
				...(padded ? { padding: space[4] } : null),
			}}
		>
			<Text accessibilityRole="header" tone="attention" variant="section">
				{t("sync.title")}
			</Text>
			{entries.map((entry) => (
				<View key={entry.clientId} style={{ gap: space[1] }}>
					{/* One stop for what it is; Try again and Discard stay their own stops. */}
					<View accessible style={{ gap: space[1] }}>
						<View style={{ flexDirection: "row", gap: space[3] }}>
							<Text numberOfLines={1} style={{ flex: 1 }}>
								{entry.title}
							</Text>
							{entry.amount ? (
								<Text tabular>
									{format(entry.amount, { cents: true }) ?? ""}
								</Text>
							) : null}
						</View>
						<Text tone="fg2" variant="small">
							{t("sync.refused")}
						</Text>
					</View>
					<View style={{ flexDirection: "row" }}>
						<Pressable
							accessibilityLabel={`${t("sync.retry")}, ${entry.title}`}
							accessibilityRole="button"
							onPress={async () => {
								const sent = await retry(entry.clientId);
								announceEntryChange();
								if (!sent) toast.show({ message: t("sync.retryFailed") });
							}}
							style={action}
						>
							<Text style={{ color: color.brand }}>{t("sync.retry")}</Text>
						</Pressable>
						<Pressable
							accessibilityLabel={`${t("sync.discard")}, ${entry.title}`}
							accessibilityRole="button"
							onPress={async () => {
								await discard(entry.clientId);
								toast.show({
									message: t("toast.discarded", { title: entry.title }),
								});
							}}
							style={action}
						>
							<Text tone="danger">{t("sync.discard")}</Text>
						</Pressable>
					</View>
				</View>
			))}
		</View>
	);
}
