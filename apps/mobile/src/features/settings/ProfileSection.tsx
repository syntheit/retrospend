import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { absoluteImage } from "@/features/read/faces";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { ListGroup, ListRow } from "@/ui/List";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { FieldError, TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { BackgroundSheet } from "./BackgroundSheet";
import { PageState, SettingsPage } from "./parts";
import { hostOf, type Profile } from "./source";
import { useAvatar } from "./useAvatar";
import { useProfile } from "./useSettings";
import { openWebPage } from "./webPages";

const USERNAME = /^[a-zA-Z0-9]{1,50}$/;

/**
 * Profile: your face (upload from the camera or library, or remove it), your
 * display name and username as fields that save when you leave them, your
 * email (changed on the web, where it asks for your password and sends a
 * confirmation link) and your public page (copy its link).
 */
export function ProfileSection() {
	const profile = useProfile();
	const me = profile.state.status === "ready" ? profile.state.data : null;
	if (!me)
		return (
			<PageState
				failed={profile.state.status === "error"}
				onRetry={() => void profile.reload()}
			/>
		);
	return <ProfileBody me={me} reload={profile.reload} />;
}

function ProfileBody({ me, reload }: { me: Profile; reload: () => void }) {
	const t = useTranslations("mobile.settings.profile");
	const ts = useTranslations("mobile.settings");
	const tc = useTranslations("mobile.common");
	const { connection } = useServerConnection();
	const { api, refreshMe } = useSession();
	const { space } = useTheme();
	const toast = useToast();
	const avatar = useAvatar(reload);
	const [name, setName] = useState(me.name);
	const [username, setUsername] = useState(me.username);
	const [backgroundOpen, setBackgroundOpen] = useState(false);

	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const publicPath = `/u/${me.username}`;
	const hasPhoto = Boolean(me.avatarUrl);
	const nameOk = name.trim().length > 0;
	const userOk = USERNAME.test(username);

	async function update(patch: { name?: string; username?: string }) {
		if (!api) return false;
		try {
			await api.profile.update(patch, {
				context: { idempotencyKey: newClientId() },
			});
			await refreshMe();
			reload();
			return true;
		} catch {
			return false;
		}
	}

	async function saveName() {
		const next = name.trim();
		if (!nameOk || next === me.name) return;
		const before = me.name;
		if (!(await update({ name: next }))) {
			setName(before);
			toast.show({ message: t("error") });
			return;
		}
		toast.show({
			message: ts("saved"),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					setName(before);
					if (await update({ name: before })) return;
					// The server still has the new name: show it, and say so.
					setName(next);
					toast.show({ message: t("error") });
				},
			},
		});
	}

	// A username can change once every 30 days and the old one stays
	// reserved, so nothing can undo it: it asks first, as the web does.
	function saveUsername() {
		if (!userOk || username === me.username) return;
		const next = username;
		const old = me.username;
		Alert.alert(
			t("changeUsernameTitle", { username: next }),
			t("changeUsernameBody", { old }),
			[
				{
					text: t("keepUsername"),
					style: "cancel",
					onPress: () => setUsername(old),
				},
				{
					text: t("changeUsername"),
					onPress: () => {
						void (async () => {
							const ok = await update({ username: next });
							if (!ok) setUsername(old);
							toast.show({
								message: ok
									? t("usernameSaved", { username: next })
									: t("usernameRefused"),
							});
						})();
					},
				},
			],
		);
	}

	function chooseSource() {
		Alert.alert(t("uploadPhoto"), undefined, [
			{ text: t("takePhoto"), onPress: () => void avatar.pick("camera") },
			{ text: t("choosePhoto"), onPress: () => void avatar.pick("library") },
			{ text: tc("cancel"), style: "cancel" },
		]);
	}

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
		<SettingsPage>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[4],
					paddingHorizontal: space[4],
					paddingBottom: space[4],
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
				<View style={{ flex: 1, gap: space[1] }}>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[2],
						}}
					>
						<Button
							disabled={avatar.busy !== null}
							label={t("uploadPhoto")}
							onPress={chooseSource}
							size="small"
							variant="outlined"
						/>
						{hasPhoto ? (
							<Button
								disabled={avatar.busy !== null}
								label={t("removePhoto")}
								onPress={avatar.confirmRemove}
								size="small"
								variant="text"
							/>
						) : null}
					</View>
					<Text tone="fg3" variant="meta">
						{t("photoHint")}
					</Text>
				</View>
			</View>
			<View style={{ paddingHorizontal: space[4], gap: space[4] }}>
				<View style={{ gap: space[1] }}>
					<TextField
						autoCapitalize="words"
						invalid={!nameOk}
						label={t("displayName")}
						onChangeText={setName}
						onTypingChange={(typing) => {
							if (!typing) void saveName();
						}}
						value={name}
					/>
					{nameOk ? null : <FieldError>{t("nameRequired")}</FieldError>}
				</View>
				<View style={{ gap: space[1] }}>
					<TextField
						invalid={!userOk}
						label={t("username")}
						onChangeText={setUsername}
						onTypingChange={(typing) => {
							if (!typing) saveUsername();
						}}
						prefix="@"
						value={username}
					/>
					{userOk ? (
						<Text tone="fg3" variant="meta">
							{t("usernameHint")}
						</Text>
					) : (
						<FieldError>{t("usernameRule")}</FieldError>
					)}
				</View>
			</View>
			<View style={{ height: space[6] }} />
			<ListGroup>
				<ListRow
					end={
						<Button
							label={t("changeEmail")}
							onPress={() => {
								if (baseUrl) void openWebPage(baseUrl, "/settings");
							}}
							size="small"
							variant="outlined"
						/>
					}
					sub={
						me.pendingEmail ? (
							<StatusText
								label={t("pending", { email: me.pendingEmail.email })}
								size="sm"
								tone="info"
							/>
						) : (
							me.email
						)
					}
					title={t("email")}
				/>
				{baseUrl ? (
					<ListRow
						end={
							<View
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: space[2],
								}}
							>
								<Button
									label={t("copyLink")}
									onPress={() => void copyLink()}
									size="small"
									variant="outlined"
								/>
								<Button
									label={t("background")}
									onPress={() => setBackgroundOpen(true)}
									size="small"
									variant="outlined"
								/>
							</View>
						}
						sub={`${hostOf(baseUrl)}${publicPath}`}
						title={t("public")}
					/>
				) : null}
			</ListGroup>
			<BackgroundSheet
				onClose={() => setBackgroundOpen(false)}
				visible={backgroundOpen}
			/>
		</SettingsPage>
	);
}
