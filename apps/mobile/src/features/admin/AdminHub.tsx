import { router } from "expo-router";
import { useTranslations } from "use-intl";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow } from "@/ui/List";
import { NavEnd, PageState, SettingsPage } from "../settings/parts";
import { useAdminRead } from "./useAdminRead";

/**
 * Admin, as a list of what an admin can run from the phone: the accounts,
 * the invite codes, the feedback inbox and the server settings. Each row says
 * where it stands. Nothing else is linked: what the phone does not do is not
 * offered here.
 */
export function AdminHub() {
	const t = useTranslations("mobile.admin");
	const { state, reload } = useAdminRead(async (api) => {
		const [stats, feedback, settings] = await Promise.all([
			api.admin.stats(),
			api.admin.listFeedback({ limit: 1 }),
			api.admin.getSettings(),
		]);
		return { stats, feedback, settings };
	});

	if (state.status !== "ready") {
		return (
			<PageState
				failed={state.status === "error"}
				onRetry={() => void reload()}
			/>
		);
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
		</SettingsPage>
	);
}
