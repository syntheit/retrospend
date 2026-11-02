import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
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
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const { format } = useFormatMoney();
	const toast = useToast();
	const { entries, retry, discard } = useParkedEntries();
	// The entry being sent again: Android shows the loading indicator beside it.
	const [retrying, setRetrying] = useState<string | null>(null);
	if (entries.length === 0) return null;

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
					<View style={{ flexDirection: "row", alignItems: "center" }}>
						{retrying === entry.clientId ? (
							<LoadingIndicator size={space[6]} />
						) : null}
						<TextAction
							accessibilityLabel={`${tc("retry")}, ${entry.title}`}
							label={tc("retry")}
							onPress={async () => {
								if (retrying !== null) return;
								setRetrying(entry.clientId);
								try {
									const sent = await retry(entry.clientId);
									announceEntryChange();
									if (!sent) toast.show({ message: t("sync.retryFailed") });
								} finally {
									setRetrying(null);
								}
							}}
						/>
						<TextAction
							accessibilityLabel={`${t("sync.discard")}, ${entry.title}`}
							label={t("sync.discard")}
							onPress={async () => {
								await discard(entry.clientId);
								toast.show({
									message: t("toast.discarded", { title: entry.title }),
								});
							}}
							tone="danger"
						/>
					</View>
				</View>
			))}
		</View>
	);
}
