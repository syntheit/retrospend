import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Text } from "@/ui/Text";
import type { SharedDetail } from "./useEntryDetail";

/**
 * Who is on a split and each person's share (the mockup's shares list): a
 * face, the name with "paid" after the payer, and the amount at the end. The
 * amounts are the server's, from the split's detail.
 */
export function EntryShares({ detail }: { detail: SharedDetail }) {
	const t = useTranslations("mobile.entry");
	const money = useMoneyText();
	const faces = useFaces();
	const { state } = useSession();
	const { size, space } = useTheme();
	const me = state.status === "signedIn" ? state.me : null;
	if (detail.splits.length < 2) return null;
	return (
		<View style={{ gap: space[2], paddingBottom: space[2] }}>
			<Text accessibilityRole="header" weight="semibold">
				{t("shares")}
			</Text>
			{detail.splits.map((split) => {
				const key = `${split.type}:${split.id}`;
				const you = split.type === "user" && split.id === me?.id;
				const paid =
					split.type === detail.paidBy.type && split.id === detail.paidBy.id;
				const face = faces([
					{ key, name: split.name, imageUrl: split.imageUrl },
				])[0];
				return (
					<View
						key={key}
						style={{
							minHeight: size.avatar.default,
							flexDirection: "row",
							alignItems: "center",
							gap: space[2],
						}}
					>
						{face ? <Avatar face={face} size="xs" /> : null}
						<Text numberOfLines={1} style={{ flex: 1 }}>
							{you ? t("you") : split.name}
							{paid ? (
								<Text tone="fg3" variant="small">
									{` ${t("paid")}`}
								</Text>
							) : null}
						</Text>
						<Text tabular weight="medium">
							{money(split.share)}
						</Text>
					</View>
				);
			})}
		</View>
	);
}
