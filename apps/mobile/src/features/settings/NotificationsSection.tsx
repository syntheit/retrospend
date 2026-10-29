import { NOTIFICATION_TYPES } from "@retrospend/api-contract";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { usePush } from "@/push/PushProvider";
import { useTheme } from "@/theme";
import { ListGroup, ListRow } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { useToast } from "@/ui/Toast";
import {
	channelsOn,
	hasInbox,
	hasPush,
	type NotificationChannel,
} from "./channels";
import { Block, GroupNote, NavEnd, PageState, SettingsPage } from "./parts";
import {
	type NotificationPreference,
	type NotificationType,
	preferenceOf,
	withChannel,
} from "./source";
import { useNotificationPreferences } from "./useSettings";

/**
 * Notifications: Push on this phone, then one row per kind of news. A row
 * says which channels are on and opens a sheet with a switch for each. Every
 * switch saves at once, from the tap.
 */
export function NotificationsSection() {
	const t = useTranslations("mobile.settings");
	const tn = useTranslations("mobile.settings.notify");
	const tc = useTranslations("mobile.settings.notifications.channel");
	const { api } = useSession();
	const toast = useToast();
	const push = usePush();
	const read = useNotificationPreferences();
	const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
	const [open, setOpen] = useState<NotificationType | null>(null);

	// The switches follow the server's answer, and change at once when tapped.
	useEffect(() => {
		if (read.state.status === "ready") {
			setPrefs(read.state.data.preferences);
		}
	}, [read.state]);

	if (read.state.status !== "ready" && prefs.length === 0) {
		return <PageState failed={read.state.status === "error"} />;
	}

	async function setChannel(
		type: NotificationType,
		channel: NotificationChannel,
		on: boolean,
	) {
		if (!api) return;
		const next = withChannel(prefs, type, channel, on);
		setPrefs(next);
		const changed = preferenceOf(next, type);
		if (!changed) return;
		try {
			await api.notifications.updatePreferences(
				{ preferences: [changed] },
				{ context: { idempotencyKey: newClientId() } },
			);
		} catch {
			toast.show({ message: t("saveError") });
			read.reload();
		}
	}

	async function togglePush(next: boolean) {
		if (!next) {
			await push.disable();
			return;
		}
		const result = await push.enable();
		if (result === "denied") toast.show({ message: t("push.denied") });
		if (result === "unavailable")
			toast.show({ message: t("push.unavailable") });
	}

	const types = NOTIFICATION_TYPES.filter((type) => preferenceOf(prefs, type));
	const opened = open ? preferenceOf(prefs, open) : null;
	return (
		<>
			<SettingsPage>
				{push.supported ? (
					<Block title={t("push.title")}>
						<ListGroup>
							<ListRow>
								<View style={{ flex: 1 }}>
									<SwitchRow
										label={t("push.master")}
										onChange={togglePush}
										value={push.on}
									/>
								</View>
							</ListRow>
						</ListGroup>
						<GroupNote>
							{t(
								Platform.OS === "ios" ? "push.footerIos" : "push.footerAndroid",
							)}
						</GroupNote>
					</Block>
				) : null}
				<Block title={t("root.notifications")}>
					<ListGroup>
						{types.map((type) => {
							const pref = preferenceOf(prefs, type);
							const on = pref ? channelsOn(pref, push.on) : [];
							return (
								<ListRow
									accessibilityLabel={tn(type)}
									end={<NavEnd />}
									key={type}
									onPress={() => setOpen(type)}
									sub={
										on.length > 0
											? on.map((channel) => tc(channel)).join(", ")
											: t("notifications.none")
									}
									title={tn(type)}
								/>
							);
						})}
					</ListGroup>
				</Block>
			</SettingsPage>
			<ChannelSheet
				onChange={(channel, on) => open && setChannel(open, channel, on)}
				onClose={() => setOpen(null)}
				preference={opened}
				pushOn={push.on}
				pushSupported={push.supported}
			/>
		</>
	);
}

/**
 * The channels one kind of news can arrive on, a switch each. Only the
 * channels the kind has show: no inbox or email for a recurring due, no push
 * for a kind the server never pushes, no push switch while the phone has
 * none (it is turned on above).
 */
function ChannelSheet({
	preference,
	pushOn,
	pushSupported,
	onChange,
	onClose,
}: {
	preference: NotificationPreference | null;
	pushOn: boolean;
	pushSupported: boolean;
	onChange: (channel: NotificationChannel, on: boolean) => void;
	onClose: () => void;
}) {
	const tn = useTranslations("mobile.settings.notify");
	const tc = useTranslations("mobile.settings.notifications.channel");
	const { space } = useTheme();
	const type = preference?.type;
	const inbox = type ? hasInbox(type) : false;
	const pushes = type && pushSupported && pushOn ? hasPush(type) : false;
	return (
		<Sheet
			detents={["medium"]}
			dismiss="done"
			onClose={onClose}
			title={type ? tn(type) : undefined}
			visible={preference !== null}
		>
			<View style={{ gap: space[1] }}>
				{preference && inbox ? (
					<>
						<SwitchRow
							label={tc("inApp")}
							onChange={(on) => onChange("inApp", on)}
							value={preference.inApp}
						/>
						<SwitchRow
							label={tc("email")}
							onChange={(on) => onChange("email", on)}
							value={preference.email}
						/>
					</>
				) : null}
				{preference && pushes ? (
					<SwitchRow
						label={tc("push")}
						onChange={(on) => onChange("push", on)}
						value={preference.push}
					/>
				) : null}
			</View>
		</Sheet>
	);
}
