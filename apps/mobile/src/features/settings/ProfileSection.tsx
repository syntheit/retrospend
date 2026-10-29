import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { absoluteImage } from "@/features/read/faces";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { ListGroup, ListRow } from "@/ui/List";
import { Menu } from "@/ui/Menu";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { ProfileSheet } from "./ProfileSheet";
import { Block, NavEnd, PageState, SettingsPage } from "./parts";
import { hostOf } from "./source";
import { useAvatar } from "./useAvatar";
import { useProfile } from "./useSettings";

/**
 * Profile: your face (upload from the camera or library, or remove it), name
 * and username (tap to edit), email, and your public page (copy its link). The email and the password change on the web, where they ask
 * for your password and send a confirmation link.
 */
export function ProfileSection() {
	const t = useTranslations("mobile.settings.profile");
	const { connection } = useServerConnection();
	const { space } = useTheme();
	const profile = useProfile();
	const toast = useToast();
	const avatar = useAvatar(profile.reload);
	const [editing, setEditing] = useState(false);
	const me = profile.state.status === "ready" ? profile.state.data : null;
	if (!me) return <PageState failed={profile.state.status === "error"} />;

	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const publicPath = `/u/${me.username}`;
	const hasPhoto = Boolean(me.avatarUrl);

	async function copyLink() {
		if (!baseUrl) return;
		try {
			await Clipboard.setStringAsync(
				`${baseUrl.replace(/\/$/, "")}${publicPath}`,
			);
			toast.show({ message: t("linkCopied") });
		} catch {
			toast.show({ message: t("copyFailed") });
		}
	}

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
				<View
					style={{
						paddingHorizontal: space[4],
						paddingBottom: space[2],
					}}
				>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[2],
						}}
					>
						<Menu
							items={[
								{
									id: "camera",
									label: t("takePhoto"),
									onPress: () => void avatar.pick("camera"),
								},
								{
									id: "library",
									label: t("choosePhoto"),
									onPress: () => void avatar.pick("library"),
								},
							]}
							label={t("uploadPhoto")}
						/>
						{hasPhoto ? (
							<Button
								disabled={avatar.busy !== null}
								label={t("removePhoto")}
								onPress={avatar.confirmRemove}
								variant="text"
							/>
						) : null}
					</View>
					<Text tone="fg3" variant="meta">
						{t("photoHint")}
					</Text>
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
								end={
									<Button
										label={t("copyLink")}
										onPress={() => void copyLink()}
										size="small"
										variant="outlined"
									/>
								}
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
