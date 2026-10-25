import { Pressable, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
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
	const { color, size, space, type } = useTheme();
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
			<Text
				accessibilityRole="header"
				style={{
					color: color.attentionText,
					fontSize: type.section.size,
					fontWeight: "600",
				}}
			>
				{t("sync.title")}
			</Text>
			{entries.map((entry) => (
				<View accessible key={entry.clientId} style={{ gap: space[1] }}>
					<View style={{ flexDirection: "row", gap: space[3] }}>
						<Text
							numberOfLines={1}
							style={{ flex: 1, color: color.fg, fontSize: type.body.size }}
						>
							{entry.title}
						</Text>
						{entry.amount ? (
							<Text
								style={{
									color: color.fg,
									fontSize: type.body.size,
									fontVariant: ["tabular-nums"],
								}}
							>
								{format(entry.amount, { cents: true }) ?? ""}
							</Text>
						) : null}
					</View>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("sync.refused")}
					</Text>
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
							<Text style={{ color: color.brand, fontSize: type.body.size }}>
								{t("sync.retry")}
							</Text>
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
							<Text style={{ color: color.danger, fontSize: type.body.size }}>
								{t("sync.discard")}
							</Text>
						</Pressable>
					</View>
				</View>
			))}
		</View>
	);
}
