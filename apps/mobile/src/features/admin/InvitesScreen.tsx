import { Stack } from "expo-router";
import { type ReactNode, useState } from "react";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { AddButton } from "@/ui/AddButton";
import { GroupItem, ListGroup } from "@/ui/List";
import { SwitchRow } from "@/ui/SwitchRow";
import { useToast } from "@/ui/Toast";
import { TopBarAction } from "@/ui/TopBarAction";
import { Block, PageState, SettingsPage } from "../settings/parts";
import {
	InviteCodeList,
	type InviteStatus,
	readInviteCodes,
} from "./InviteCodeList";
import { InviteSheet } from "./InviteSheet";
import { detailOf, useAdminRead } from "./useAdminRead";
import { useServerSettings } from "./useServerSettings";

/**
 * The codes, Active or Used, newest first, for the server's (`admin`) or the
 * person's own (`mine`) endpoints. The plus in the bar makes a new code and
 * opens it; tapping a code opens its sheet to copy, share or delete it.
 * `settings` is the Admin's block above the codes.
 */
function InviteCodes({
	scope,
	settings,
}: {
	scope: "admin" | "mine";
	settings?: ReactNode;
}) {
	const t = useTranslations("mobile.admin.invites");
	const { api } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const mine = scope === "mine";
	const [status, setStatus] = useState<InviteStatus>("active");
	const [openId, setOpenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	const codes = useAdminRead(
		(client) =>
			readInviteCodes(
				(query) =>
					mine
						? client["invite-codes"].list(query)
						: client.admin.listInviteCodes(query),
				status,
			),
		status,
	);

	async function create() {
		if (!api || creating) return;
		setCreating(true);
		try {
			const call = { context: { idempotencyKey: newClientId() } };
			const made = mine
				? await api["invite-codes"].create(undefined, call)
				: await api.admin.createInviteCode(undefined, call);
			setStatus("active");
			await codes.reload();
			setOpenId(made.id);
			toast.show({ message: t("created") });
		} catch (error) {
			toast.show({ message: detailOf(error) ?? t("createError") });
		} finally {
			setCreating(false);
		}
	}

	const items = codes.state.status === "ready" ? codes.state.data : null;
	const open = items?.find((code) => code.id === openId) ?? null;

	return (
		<>
			{/* The plus is the bar's: the system glass plus on iOS, the plus icon on Android. */}
			<Stack.Screen
				options={{
					headerRight: () =>
						Platform.OS === "ios" ? (
							<AddButton label={t("create")} onPress={() => void create()} />
						) : (
							<TopBarAction
								icon="Plus"
								id="create"
								label={t("create")}
								onPress={() => {
									if (!creating) void create();
								}}
							/>
						),
				}}
			/>
			<SettingsPage>
				{settings}
				<Block title={t("codes")}>
					<InviteCodeList
						codes={codes}
						mine={mine}
						onOpen={setOpenId}
						onStatus={setStatus}
						status={status}
					/>
				</Block>
				{settings ? <View style={{ height: space[2] }} /> : null}
			</SettingsPage>
			<InviteSheet
				invite={open}
				key={open?.id ?? "none"}
				mine={mine}
				onChanged={codes.reload}
				onClose={() => setOpenId(null)}
			/>
		</>
	);
}

/**
 * Invite codes (Admin): whether sign-up needs a code and whether every user
 * may make their own (both save at once), then the codes.
 */
export function InvitesScreen() {
	const t = useTranslations("mobile.admin.invites");
	const settings = useServerSettings();
	if (settings.state.status !== "ready") {
		return (
			<PageState
				failed={settings.state.status === "error"}
				onRetry={() => void settings.reload()}
			/>
		);
	}
	const server = settings.state.data;
	return (
		<InviteCodes
			scope="admin"
			settings={
				<ListGroup form>
					<GroupItem>
						<SwitchRow
							detail={t("requireDetail")}
							label={t("require")}
							onChange={(on) => void settings.save({ inviteOnlyEnabled: on })}
							value={server.inviteOnlyEnabled}
						/>
					</GroupItem>
					<GroupItem>
						<SwitchRow
							detail={t("everyoneDetail")}
							label={t("everyone")}
							onChange={(on) =>
								void settings.save({ allowAllUsersToGenerateInvites: on })
							}
							value={server.allowAllUsersToGenerateInvites}
						/>
					</GroupItem>
				</ListGroup>
			}
		/>
	);
}

/**
 * Your own invite codes, for a person the server lets invite (the web's
 * Invite codes page). None of the server's invite settings are here: those
 * are Admin's.
 */
export function InviteCodesScreen() {
	return <InviteCodes scope="mine" />;
}
