import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { absoluteImage } from "@/features/read/faces";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { ListGroup, ListRow } from "@/ui/List";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { ProfileSheet } from "./ProfileSheet";
import { Block, NavEnd, PageState, SettingsPage } from "./parts";
import { hostOf } from "./source";
import { useProfile } from "./useSettings";
import { openWebPage } from "./webPages";

/**
 * Profile: your face, name and username (tap to edit), email, and your
 * public page. The email and the password change on the web, where they ask
 * for your password and send a confirmation link.
 */
export function ProfileSection() {
	const t = useTranslations("mobile.settings.profile");
	const { connection } = useServerConnection();
	const { space } = useTheme();
	const profile = useProfile();
	const [editing, setEditing] = useState(false);
	const me = profile.state.status === "ready" ? profile.state.data : null;
	if (!me) return <PageState failed={profile.state.status === "error"} />;

	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const publicPath = `/u/${me.username}`;
	return (
		<>
			<SettingsPage>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space[4],
						paddingHorizontal: space[4],
						paddingBottom: space[2],
					}}
				>
					<Avatar
						face={{
							key: `user:${me.id}`,
							name: me.name,
							imageUri: absoluteImage(me.avatarUrl, baseUrl),
						}}
						size="xl"
					/>
					<View style={{ flex: 1 }}>
						<Text numberOfLines={1} variant="section">
							{me.name}
						</Text>
						<Text numberOfLines={1} tone="fg2">
							{`@${me.username}`}
						</Text>
					</View>
				</View>
				<Block>
					<ListGroup>
						<ListRow
							end={<NavEnd />}
							onPress={() => setEditing(true)}
							title={t("edit")}
						/>
						<ListRow
							sub={
								me.pendingEmail ? (
									<StatusText
										label={t("pending", { email: me.pendingEmail.email })}
										size="sm"
										tone="info"
									/>
								) : undefined
							}
							title={t("email")}
						>
							<Text numberOfLines={1} style={{ flexShrink: 1 }} tone="fg2">
								{me.email}
							</Text>
						</ListRow>
						{baseUrl ? (
							<ListRow
								end={<NavEnd />}
								onPress={() => void openWebPage(baseUrl, publicPath)}
								sub={`${hostOf(baseUrl)}${publicPath}`}
								title={t("public")}
							/>
						) : null}
					</ListGroup>
				</Block>
			</SettingsPage>
			<ProfileSheet
				onClose={() => setEditing(false)}
				onSaved={() => {
					profile.reload();
				}}
				profile={me}
				visible={editing}
			/>
		</>
	);
}
