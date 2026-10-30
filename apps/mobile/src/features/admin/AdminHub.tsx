import { router } from "expo-router";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { useTheme } from "@/theme";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow } from "@/ui/List";
import { GroupNote, NavEnd, PageState, SettingsPage } from "../settings/parts";
import { openWebPage } from "../settings/webPages";
import { useAdminRead } from "./useAdminRead";

/** The web page the rest of Admin lives on. */
const WEB_ADMIN = "/admin";

/**
 * Admin, as a list of what an admin can run from the phone: the accounts,
 * the invite codes, the feedback inbox and the server settings. Each row says
 * where it stands. What needs a keyboard or a long table (email, backups, logs,
 * AI usage, password resets) opens the web admin.
 */
export function AdminHub() {
	const t = useTranslations("mobile.admin");
	const { space } = useTheme();
	const { connection } = useServerConnection();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const { state } = useAdminRead(async (api) => {
		const [stats, feedback, settings] = await Promise.all([
			api.admin.stats(),
			api.admin.listFeedback({ limit: 1 }),
			api.admin.getSettings(),
		]);
		return { stats, feedback, settings };
	});

	if (state.status !== "ready") {
		return <PageState failed={state.status === "error"} />;
	}
	const { stats, feedback, settings } = state.data;

	return (
		<SettingsPage>
			<ListGroup>
				<ListRow
					end={<NavEnd />}
					lead={<IconTile name="Users" />}
					onPress={() => router.push("/settings/admin-users")}
					sub={t("hub.users", { count: stats.userCount })}
					title={t("users.title")}
				/>
				<ListRow
					end={<NavEnd />}
					lead={<IconTile name="KeyRound" />}
					onPress={() => router.push("/settings/admin-invites")}
					sub={
						settings.inviteOnlyEnabled
							? t("hub.inviteOnly")
							: t("hub.openSignUp")
					}
					title={t("invites.title")}
				/>
				<ListRow
					end={<NavEnd />}
					lead={<IconTile name="MessageSquare" />}
					onPress={() => router.push("/settings/admin-feedback")}
					sub={
						feedback.counts.unread > 0
							? t("hub.unread", { count: feedback.counts.unread })
							: t("hub.noUnread")
					}
					title={t("feedback.title")}
				/>
				<ListRow
					end={<NavEnd />}
					lead={<IconTile name="SlidersHorizontal" />}
					onPress={() => router.push("/settings/admin-settings")}
					sub={t("hub.settings")}
					title={t("settings.title")}
				/>
			</ListGroup>
			{baseUrl ? (
				<>
					<View style={{ height: space[6] }} />
					<ListGroup>
						<ListRow
							end={<NavEnd />}
							onPress={() => void openWebPage(baseUrl, WEB_ADMIN)}
							title={t("hub.web")}
						/>
					</ListGroup>
					<GroupNote>{t("hub.webNote")}</GroupNote>
				</>
			) : null}
		</SettingsPage>
	);
}
