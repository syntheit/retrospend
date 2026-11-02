import { useTranslations } from "use-intl";
import { useOpenSettingsRoute } from "@/layout/settingsPath";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow } from "@/ui/List";
import { PageState, SettingsPage } from "../settings/parts";
import { useAdminRead } from "./useAdminRead";

/**
 * Admin, as a list of everything the web's Admin has: the accounts, people
 * added without one, invite codes, the feedback inbox and crash reports, AI
 * usage, the server's state and backups, the audit log and the server
 * settings. Each row says where it stands.
 */
export function AdminHub() {
	const t = useTranslations("mobile.admin");
	const open = useOpenSettingsRoute();
	const { state, reload } = useAdminRead(async (api) => {
		const [stats, feedback, settings, errors] = await Promise.all([
			api.admin.stats(),
			api.admin.listFeedback({ limit: 1 }),
			api.admin.getSettings(),
			api.admin.listErrorReports({ limit: 1 }),
		]);
		return { stats, feedback, settings, errors };
	});

	if (state.status !== "ready") {
		return (
			<PageState
				failed={state.status === "error"}
				onRetry={() => void reload()}
			/>
		);
	}
	const { stats, feedback, settings, errors } = state.data;

	return (
		<SettingsPage>
			<ListGroup>
				<ListRow
					chevron
					lead={<IconTile name="Users" />}
					onPress={() => open("admin-users")}
					sub={t("hub.users", { count: stats.userCount })}
					title={t("users.title")}
				/>
				<ListRow
					chevron
					lead={<IconTile name="User" />}
					onPress={() => open("admin-participants")}
					sub={t("hub.participants")}
					title={t("participants.title")}
				/>
				<ListRow
					chevron
					lead={<IconTile name="KeyRound" />}
					onPress={() => open("invite-codes")}
					sub={
						settings.inviteOnlyEnabled
							? t("hub.inviteOnly")
							: t("hub.openSignUp")
					}
					title={t("invites.title")}
				/>
				<ListRow
					chevron
					lead={<IconTile name="MessageSquare" />}
					onPress={() => open("admin-feedback")}
					sub={
						feedback.counts.unread > 0
							? t("hub.unread", { count: feedback.counts.unread })
							: t("hub.noUnread")
					}
					title={t("feedback.title")}
				/>
				<ListRow
					chevron
					lead={<IconTile name="TriangleAlert" />}
					onPress={() => open("admin-errors")}
					sub={t("hub.errors", { count: errors.total })}
					title={t("errors.title")}
				/>
				<ListRow
					chevron
					lead={<IconTile name="Zap" />}
					onPress={() => open("admin-ai-usage")}
					sub={t("hub.aiUsage")}
					title={t("aiUsage.title")}
				/>
				<ListRow
					chevron
					lead={<IconTile name="Monitor" />}
					onPress={() => open("admin-server")}
					sub={t("hub.server")}
					title={t("server.title")}
				/>
				<ListRow
					chevron
					lead={<IconTile name="ListChecks" />}
					onPress={() => open("admin-audit")}
					sub={t("hub.audit")}
					title={t("audit.title")}
				/>
				<ListRow
					chevron
					lead={<IconTile name="SlidersHorizontal" />}
					onPress={() => open("admin-settings")}
					sub={t("hub.settings")}
					title={t("settings.title")}
				/>
			</ListGroup>
		</SettingsPage>
	);
}
